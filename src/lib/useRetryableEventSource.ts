import { useCallback, useEffect, useRef } from "react";
import { notifications } from "@mantine/notifications";

type RetryOptions = {
    onMessage: (event: MessageEvent) => void;
    onOpen?: () => void;
    onError?: (event: Event) => void;
    notificationId?: string;
    notificationLabel?: string;
    reconnectInitialDelay?: number;
    reconnectMaxDelay?: number;
    reconnectBackoffFactor?: number;
    maxReconnectAttempts?: number;
};

type RetryableEventSourceControls = {
    start: (url: string) => void;
    stop: () => void;
};

const DEFAULT_INITIAL_DELAY = 1000;
const DEFAULT_MAX_DELAY = 10000;
const DEFAULT_BACKOFF = 2;

export function useRetryableEventSource({
    onMessage,
    onOpen,
    onError,
    notificationId,
    notificationLabel = "SSE",
    reconnectInitialDelay = DEFAULT_INITIAL_DELAY,
    reconnectMaxDelay = DEFAULT_MAX_DELAY,
    reconnectBackoffFactor = DEFAULT_BACKOFF,
    maxReconnectAttempts = Infinity
}: RetryOptions): RetryableEventSourceControls {
    const esRef = useRef<EventSource | null>(null);
    const lastUrlRef = useRef<string | null>(null);
    const shouldReconnectRef = useRef(false);
    const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
    const attemptsRef = useRef(0);
    const notificationVisibleRef = useRef(false);

    const messageHandlerRef = useRef(onMessage);
    const openHandlerRef = useRef(onOpen);
    const errorHandlerRef = useRef(onError);

    useEffect(() => {
        messageHandlerRef.current = onMessage;
    }, [onMessage]);

    useEffect(() => {
        openHandlerRef.current = onOpen;
    }, [onOpen]);

    useEffect(() => {
        errorHandlerRef.current = onError;
    }, [onError]);

    const hideNotification = useCallback(() => {
        if (!notificationId || !notificationVisibleRef.current) return;
        notifications.hide(notificationId);
        notificationVisibleRef.current = false;
    }, [notificationId]);

    const cleanup = useCallback(() => {
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        esRef.current?.close();
        esRef.current = null;
    }, []);

    const showReconnectNotification = useCallback((attempt: number, delay: number) => {
        if (!notificationId) return;
        const seconds = Math.round(delay / 100) / 10;
        const message = `${notificationLabel}の接続が切断されました。${attempt}回目の再接続を${seconds.toFixed(1)}秒後に試行します。`;
        if (!notificationVisibleRef.current) {
            notifications.show({
                id: notificationId,
                title: `${notificationLabel}の接続エラー`,
                message,
                color: "orange",
                loading: true,
                autoClose: false,
                withCloseButton: false
            });
            notificationVisibleRef.current = true;
            return;
        }
        notifications.update({
            id: notificationId,
            title: `${notificationLabel}の接続再試行`,
            message,
            color: "orange",
            loading: true,
            autoClose: false,
            withCloseButton: false
        });
    }, [notificationId, notificationLabel]);

    const notifyReconnectSuccess = useCallback(() => {
        if (!notificationId || !notificationVisibleRef.current) return;
        notifications.update({
            id: notificationId,
            title: `${notificationLabel}に再接続しました`,
            message: "進捗の受信を再開しました。",
            color: "teal",
            loading: false,
            autoClose: 3000
        });
        notificationVisibleRef.current = false;
    }, [notificationId, notificationLabel]);

    const notifyReconnectFailure = useCallback(() => {
        if (!notificationId) return;
        const payload = {
            id: notificationId,
            title: `${notificationLabel}の接続が復旧しません`,
            message: "再接続の試行上限に達しました。",
            color: "red" as const,
            loading: false,
            autoClose: false,
            withCloseButton: true
        };
        if (!notificationVisibleRef.current) {
            notifications.show(payload);
            notificationVisibleRef.current = true;
            return;
        }
        notifications.update(payload);
    }, [notificationId, notificationLabel]);

    const connect = useCallback(() => {
        const url = lastUrlRef.current;
        if (!url) return;
        cleanup();
        const es = new EventSource(url);
        esRef.current = es;
        es.onopen = () => {
            attemptsRef.current = 0;
            notifyReconnectSuccess();
            openHandlerRef.current?.();
        };
        es.onmessage = (event) => {
            messageHandlerRef.current(event);
        };
        es.onerror = (event) => {
            errorHandlerRef.current?.(event);
            if (!shouldReconnectRef.current) {
                hideNotification();
                return;
            }
            es.close();
            if (esRef.current === es) {
                esRef.current = null;
            }
            if (attemptsRef.current >= maxReconnectAttempts) {
                notifyReconnectFailure();
                shouldReconnectRef.current = false;
                return;
            }
            const nextAttempt = attemptsRef.current + 1;
            const delay = Math.min(
                reconnectInitialDelay * Math.pow(reconnectBackoffFactor, attemptsRef.current),
                reconnectMaxDelay
            );
            attemptsRef.current = nextAttempt;
            showReconnectNotification(nextAttempt, delay);
            if (!reconnectTimerRef.current) {
                reconnectTimerRef.current = setTimeout(() => {
                    reconnectTimerRef.current = null;
                    connect();
                }, delay);
            }
        };
    }, [cleanup, hideNotification, maxReconnectAttempts, notificationId, notificationLabel, notifyReconnectFailure, notifyReconnectSuccess, reconnectBackoffFactor, reconnectInitialDelay, reconnectMaxDelay, showReconnectNotification]);

    const start = useCallback((url: string) => {
        lastUrlRef.current = url;
        shouldReconnectRef.current = true;
        attemptsRef.current = 0;
        connect();
    }, [connect]);

    const stop = useCallback(() => {
        shouldReconnectRef.current = false;
        cleanup();
        hideNotification();
    }, [cleanup, hideNotification]);

    useEffect(() => {
        return () => {
            shouldReconnectRef.current = false;
            cleanup();
            hideNotification();
        };
    }, [cleanup, hideNotification]);

    return { start, stop };
}
