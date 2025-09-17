'use client';
import { Alert, Button, Space, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { useRef, useState, useEffect, useCallback } from "react";
import { Layer } from "@/lib/progressBus";
import { ProgressEvent } from "@/lib/progressBus";
import { DownloadModal } from "@/components/Download/Modal";

type FormType = {
    repo: string;
    tag: string;
    platform: string;
}

export function DownloadPane() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<null|string>(null);
    const [opened, {open, close}] = useDisclosure(false);
    
    const [jobId, setJobId] = useState<string|null>(null);
    const [status, setStatus] = useState<string>("idle");
    const [layers, setLayers] = useState<Layer[]>([]);
    // Mutable store (no re-render on every chunk)
    const perLayerRef = useRef<Record<number, { received: number; total?: number; status: "process"|"done"|"skipped" }>>({});
    // Throttled snapshot for UI
    const [perLayerSnap, setPerLayerSnap] = useState<Record<number, { received: number; total?: number; status: "process"|"done"|"skipped" }>>({});
    // Throttle config (ms)
    const FLUSH_INTERVAL = 250;
    const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
    const scheduleFlush = useCallback(() => {
        if (flushTimerRef.current) return;
        flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            // create a shallow copy so React sees a new reference
            setPerLayerSnap({ ...perLayerRef.current });
        }, FLUSH_INTERVAL);
    }, []);
    const esRef = useRef<EventSource | null>(null);
    
    const reset = useCallback(() => {
        setJobId(null);
        setStatus("idle");
        setLayers([]);
        perLayerRef.current = {};
        setPerLayerSnap({});
        if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
        esRef.current?.close();
        esRef.current = null;
    }, [])
    
    const form = useForm<FormType>({
        mode: "uncontrolled",
        initialValues: {
            repo: "",
            tag: "",
            platform: "linux/amd64"
        },
        validate: {
            repo: (v) => v=="" ? "リポジトリを指定してください" : null,
            tag: (v) => v=="" ? "タグを指定してください" : null,
            platform: (v) => v=="" ? "プラットフォームを指定してください" : null
        }
    })
    
    const onSubmit = useCallback(async (values: typeof form.values) => {
        setLoading(true);
        setError(null);
        reset();
        setStatus("starting");
        open();
        try {
            const res = await fetch('/api/docker/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(values),
            });
            if (!res.ok) { alert("Failed to start"); return; }
            const { jobId } = await res.json();
            setJobId(jobId);
            setStatus("running");
            
            const es = new EventSource(`/api/build/progress?jobId=${jobId}`);
            esRef.current = es;
            es.onopen = () => {
                console.debug("SSE open");
            }
            es.onerror = (e) => {
                console.error("SSE error", e);
            }
            es.onmessage = (ev) => {
                const data = JSON.parse(ev.data) as ProgressEvent;
                if (data.type === 'manifest-resolved') setLayers(data.items as Layer[]);
                if (data.type === 'item-progress') {
                    const prev = perLayerRef.current[data.index] || { received: 0, total: data.total, status: "process" as const };
                    perLayerRef.current[data.index] = { received: data.received, total: data.total ?? prev.total, status: "process" };
                    scheduleFlush();
                }
                if (data.type === 'item-done') {
                    const prev = perLayerRef.current[data.index] || { received: 0, total: undefined, status: "process" as const };
                    perLayerRef.current[data.index] = { ...prev, status: "done" };
                    scheduleFlush();
                }
                if (data.type === 'stage') setStatus(data.stage);
                if (data.type === 'error') {
                    setStatus('error'); es.close();
                }
                if (data.type === 'done') {
                    setStatus('done');
                    es.close();
                }
            }
        } catch (e: any) {
            setError(e.message || "ダウンロードに失敗しました")
        } finally {
            setLoading(false);
        }
    }, [open, reset, scheduleFlush, form]);

    const handleModalClose = useCallback(() => {
        const currentJobId = jobId;
        close();
        reset();
        if (!currentJobId) return;
        (async () => {
            try {
                await fetch(`/api/build/delete?jobId=${currentJobId}`, { method: "POST" });
            } catch (err) {
                console.error("ファイル削除失敗", err);
            }
        })();
    }, [jobId, close, reset]);

    useEffect(() => {
        return () => {
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            esRef.current?.close();
        };
    }, []);
    
    return (
        <div>
            <Alert
                variant="light"
                color="yellow"
                title="注意"
                radius="lg"
                my="xl"
            >
                大きなイメージの場合、ダウンロードまでに時間がかかる可能性があります!
            </Alert>

            <form
                onSubmit={form.onSubmit(onSubmit)}
            >
                <Stack>
                    <TextInput
                        label="Repository"
                        description="欲しいDockerイメージ名を入力"
                        size="lg"
                        radius="lg"
                        placeholder="library/redis"
                        key={form.key("repo")}
                        {...form.getInputProps("repo")}
                        disabled={loading}
                    />
                    <TextInput
                        label="Tag"
                        size="lg"
                        radius="lg"
                        placeholder="7.2"
                        key={form.key("tag")}
                        {...form.getInputProps("tag")}
                        disabled={loading}
                    />
                    <TextInput
                        label="Platform"
                        size="lg"
                        radius="lg"
                        placeholder="linux/amd64"
                        key={form.key("platform")}
                        {...form.getInputProps("platform")}
                        disabled={loading}
                    />
                    <Space h="md" />
                    <Button
                        size="lg"
                        radius="lg"
                        type="submit"
                        loading={loading}
                    >
                        Build & Download
                    </Button>
                </Stack>
            </form>
        
            {error && <Alert
                color="red"
                radius="lg"
                title="エラー"
                my="lg"
                variant="light"
            >
                {error}
            </Alert>}

            <DownloadModal
                opened={opened}
                onClose={() => handleModalClose()}
                repo={form.getValues().repo}
                tag={form.getValues().tag}
                status={status}
                jobId={jobId}
                layers={layers}
                perLayer={perLayerSnap}
            />
        </div>
    );
}
