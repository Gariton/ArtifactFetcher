'use client';
import { Accordion, Button, Center, Flex, Group, Modal, RingProgress, ScrollArea, Stack, Text } from "@mantine/core";
import { IconCheck, IconStackFront } from "@tabler/icons-react";
import { LayerCard } from "@/components/LayerCard";
import { Layer, ProgressEvent } from "@/lib/progressBus";
import { nanoid } from "nanoid";
import { useEffect, useReducer, useRef, useState } from "react";

interface UploadOptions {
    registry: string;
    repo: string;
    tag: string;
    username: string;
    password: string;
    useManifest: boolean;
}

interface UploadModalProps {
    opened: boolean;
    onClose: () => void;
    files: File[];
    options: UploadOptions;
    onError?: (msg: string) => void;
}

type LayerProgress = {
    received: number;
    total?: number;
    status: "process" | "done" | "skipped";
};

type LayerState = Record<string, Record<number, LayerProgress>>;

type LayerAction =
    | { type: "reset" }
    | { type: "start"; manifest: string; index: number; total: number }
    | { type: "progress"; manifest: string; index: number; received: number; total: number }
    | { type: "done"; manifest: string; index: number }
    | { type: "skip"; manifest: string; index: number };

function layerReducer(state: LayerState, action: LayerAction): LayerState {
    switch (action.type) {
        case "reset":
            return {};
        case "start": {
            const m = state[action.manifest] || {};
            return {
                ...state,
                [action.manifest]: {
                    ...m,
                    [action.index]: { received: 0, total: action.total, status: "process" }
                }
            };
        }
        case "progress": {
            const m = state[action.manifest] || {};
            return {
                ...state,
                [action.manifest]: {
                    ...m,
                    [action.index]: { received: action.received, total: action.total, status: "process" }
                }
            };
        }
        case "done": {
            const m = state[action.manifest] || {};
            const prev = m[action.index] || { received: 0, total: 0, status: "process" };
            return {
                ...state,
                [action.manifest]: {
                    ...m,
                    [action.index]: { ...prev, status: "done" }
                }
            };
        }
        case "skip": {
            const m = state[action.manifest] || {};
            return {
                ...state,
                [action.manifest]: {
                    ...m,
                    [action.index]: { received: 100, total: 100, status: "skipped" }
                }
            };
        }
        default:
            return state;
    }
}

export function UploadModal({ opened, onClose, files, options, onError }: UploadModalProps) {
    const [jobId, setJobId] = useState<string | null>(null);
    const [manifests, setManifests] = useState<Record<string, Layer[]>>({});
    const [perLayer, dispatch] = useReducer(layerReducer, {});
    const esRef = useRef<EventSource | null>(null);

    const reset = () => {
        setJobId(null);
        setManifests({});
        dispatch({ type: "reset" });
        esRef.current?.close();
        esRef.current = null;
    };

    useEffect(() => {
        if (!opened) return;
        const start = async () => {
            reset();
            try {
                if (files.length <= 0) {
                    onError?.("Dockerイメージファイルを選択してください");
                    return;
                }
                const jobId = nanoid();
                setJobId(jobId);
                const es = new EventSource(`/api/build/progress?jobId=${jobId}`);
                esRef.current = es;
                es.onmessage = (ev) => {
                    const data = JSON.parse(ev.data) as ProgressEvent;
                    if (data.type === "repo-tag-resolved") {
                        data.items.map(({ repository, tag }) => {
                            setManifests((prev) => ({ ...prev, [`${repository}@${tag}`]: [] }));
                        });
                    }
                    if (data.type === "manifest-resolved" && data.manifestName) {
                        setManifests((prev) => ({ ...prev, [data.manifestName!]: data.items as Layer[] }));
                    }
                    if (data.type === "item-start" && data.scope === "push-item" && data.manifestName) {
                        dispatch({ type: "start", manifest: data.manifestName, index: data.index, total: data.total || 0 });
                    }
                    if (data.type === "item-progress" && data.scope === "push-item" && data.manifestName) {
                        dispatch({
                            type: "progress",
                            manifest: data.manifestName,
                            index: data.index,
                            received: data.received || 0,
                            total: data.total || 0,
                        });
                    }
                    if (data.type === "item-done" && data.scope === "push-item" && data.manifestName) {
                        dispatch({ type: "done", manifest: data.manifestName, index: data.index });
                    }
                    if (data.type === "item-skip" && data.scope === "push-item" && data.manifestName) {
                        dispatch({ type: "skip", manifest: data.manifestName, index: data.index });
                    }
                    if (data.type === "error") {
                        es.close();
                        onError?.("アップロードに失敗しました");
                    }
                    if (data.type === "done") {
                        es.close();
                    }
                };

                const fd = new FormData();
                for (const f of files) fd.append("files", f, f.name);
                const qs = new URLSearchParams({
                    jobId,
                    registry: options.registry,
                    repository: options.repo,
                    insecureTLS: "true",
                    concurrency: "1",
                    ...(options.username ? { username: options.username } : {}),
                    ...(options.password ? { password: options.password } : {}),
                    tag: options.tag,
                    useManifest: String(options.useManifest),
                });
                const res = await fetch(`/api/docker/upload-multi?${qs.toString()}`, {
                    method: "POST",
                    body: fd,
                });
                if (!res.ok) {
                    onError?.("push start failed");
                }
            } catch (e: any) {
                onError?.(e.message || "アップロードに失敗しました");
            }
        };
        start();
        return () => {
            reset();
        };
    }, [opened, files, options, onError]);

    return (
        <Modal
            opened={opened}
            onClose={() => {
                onClose();
                reset();
            }}
            centered
            radius="lg"
            size="lg"
            transitionProps={{ transition: "pop" }}
            withCloseButton={false}
            styles={{ body: { height: "100%" } }}
        >
            <Flex h="100%" direction="column" gap="sm">
                <Group justify="space-between">
                    <Group gap="xs">
                        <IconStackFront />
                        <Text fw="bold" size="lg">
                            アップロード進捗
                        </Text>
                    </Group>
                    <Text size="xs">{jobId}</Text>
                </Group>

                <ScrollArea h={600}>
                    <Accordion radius="md">
                        {Object.entries(manifests).map(([manifestName, manifestLayers]) => {
                            const record = perLayer[manifestName] || {};
                            const totalLayers = manifestLayers.length;
                            const doneLayers = Object.values(record).filter(
                                (l) => l.status === "done" || l.status === "skipped"
                            ).length;
                            const manifestPct = totalLayers > 0 ? Math.floor((doneLayers / totalLayers) * 100) : 0;
                            return (
                                <Accordion.Item key={manifestName} value={manifestName}>
                                    <Accordion.Control>
                                        <Flex gap="sm" align="center">
                                            <RingProgress
                                                sections={[{ value: manifestPct, color: "green" }]}
                                                size={50}
                                                thickness={5}
                                                label={
                                                    manifestPct >= 100 ? (
                                                        <Center>
                                                            <IconCheck size="1.3em" stroke={3} />
                                                        </Center>
                                                    ) : (
                                                        <Text size="xs" ta="center">
                                                            {manifestPct}%
                                                        </Text>
                                                    )
                                                }
                                            />
                                            <div>
                                                <Text>{manifestName}</Text>
                                                <Text size="sm" c="dimmed">
                                                    {manifestLayers.length} Layers
                                                </Text>
                                            </div>
                                        </Flex>
                                    </Accordion.Control>
                                    <Accordion.Panel>
                                        <ScrollArea h={500}>
                                            <Stack>
                                                {manifestLayers.map((layer, j) => {
                                                    const info = record[j];
                                                    const pct = info?.total
                                                        ? Math.floor((info.received / info.total) * 100)
                                                        : undefined;
                                                    return (
                                                        <LayerCard
                                                            key={j}
                                                            number={j}
                                                            progress={pct || 0}
                                                            sha={layer.digest}
                                                            total={info?.total || 0}
                                                            received={info?.received || 0}
                                                            status={info?.status || "process"}
                                                        />
                                                    );
                                                })}
                                            </Stack>
                                        </ScrollArea>
                                    </Accordion.Panel>
                                </Accordion.Item>
                            );
                        })}
                    </Accordion>
                </ScrollArea>
                <Button color="dark" radius="md" size="md" fullWidth onClick={onClose}>
                    とじる
                </Button>
            </Flex>
        </Modal>
    );
}
