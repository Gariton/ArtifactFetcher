'use client';
import { LayerCard } from "@/components/LayerCard";
import { Layer, ProgressEvent } from "@/lib/progressBus";
import { Badge, Button, Center, Group, Loader, Modal, Progress, ScrollArea, Stack, Text } from "@mantine/core";
import { IconCircleCheck, IconDownload, IconStackFront } from "@tabler/icons-react";
import { useEffect, useReducer, useRef, useState } from "react";

interface DownloadModalProps {
    repo: string;
    tag: string;
    platform: string;
    opened: boolean;
    onClose: () => void;
    onError?: (msg: string) => void;
}

type LayerProgress = {
    received: number;
    total?: number;
    status: "process" | "done" | "skipped";
};

type LayerAction =
    | { type: "reset" }
    | { type: "progress"; index: number; received: number; total: number }
    | { type: "done"; index: number };

function layerReducer(state: Record<number, LayerProgress>, action: LayerAction) {
    switch (action.type) {
        case "reset":
            return {};
        case "progress":
            return {
                ...state,
                [action.index]: {
                    received: action.received,
                    total: action.total,
                    status: "process",
                },
            };
        case "done":
            return {
                ...state,
                [action.index]: {
                    ...(state[action.index] || { received: 0, total: 0 }),
                    status: "done",
                },
            };
        default:
            return state;
    }
}

export function DownloadModal({ repo, tag, platform, opened, onClose, onError }: DownloadModalProps) {
    const [status, setStatus] = useState("idle");
    const [layers, setLayers] = useState<Layer[]>([]);
    const [perLayer, dispatch] = useReducer(layerReducer, {});
    const [jobId, setJobId] = useState<string | null>(null);
    const esRef = useRef<EventSource | null>(null);

    const reset = () => {
        setJobId(null);
        setStatus("idle");
        setLayers([]);
        dispatch({ type: "reset" });
        esRef.current?.close();
        esRef.current = null;
    };

    useEffect(() => {
        if (!opened) return;
        const start = async () => {
            reset();
            setStatus("starting");
            try {
                const res = await fetch("/api/docker/start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ repo, tag, platform }),
                });
                if (!res.ok) throw new Error("Failed to start");
                const { jobId } = await res.json();
                setJobId(jobId);
                setStatus("running");
                const es = new EventSource(`/api/build/progress?jobId=${jobId}`);
                esRef.current = es;
                es.onmessage = (ev) => {
                    const data = JSON.parse(ev.data) as ProgressEvent;
                    if (data.type === "manifest-resolved") setLayers(data.items as Layer[]);
                    if (data.type === "item-progress")
                        dispatch({
                            type: "progress",
                            index: data.index,
                            received: data.received,
                            total: data.total,
                        });
                    if (data.type === "item-done")
                        dispatch({ type: "done", index: data.index });
                    if (data.type === "stage") setStatus(data.stage);
                    if (data.type === "error") {
                        setStatus("error");
                        es.close();
                        onError?.("ダウンロードに失敗しました");
                    }
                    if (data.type === "done") {
                        setStatus("done");
                        es.close();
                    }
                };
            } catch (e: any) {
                setStatus("error");
                onError?.(e.message || "ダウンロードに失敗しました");
            }
        };
        start();
        return () => {
            reset();
        };
    }, [opened, repo, tag, platform, onError]);

    const totals = Object.values(perLayer).reduce(
        (acc, v) => {
            acc.received += v.received || 0;
            acc.total! += v.total || 0;
            return acc;
        },
        { received: 0, total: 0 }
    );
    const overallPercent = totals.total! > 0 ? Math.floor((totals.received / totals.total!) * 100) : undefined;

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
        >
            <Group justify="space-between">
                <Group gap="xs">
                    <IconStackFront />
                    <Text fw="bold" size="lg">
                        ダウンロード進捗
                    </Text>
                </Group>
                <Text size="xs">{jobId}</Text>
            </Group>

            <Group justify="space-between">
                <Text size="sm" c="dimmed">
                    {repo}:{tag}・{layers.length}Layers
                </Text>
                {status === "done" ? (
                    <Badge leftSection={<IconCircleCheck size="1em" />} color="green" radius="sm">
                        done
                    </Badge>
                ) : (
                    <Badge leftSection={<Loader size="1em" color="white" />} color="gray" radius="sm">
                        {status}
                    </Badge>
                )}
            </Group>

            <Stack py="md" gap={10}>
                <Group justify="space-between">
                    <Text fw="bold">全体の進捗</Text>
                    <Text>{overallPercent}%</Text>
                </Group>
                <Progress value={overallPercent || 0} size="lg" />
                <Text color="dimmed" size="xs">
                    {(totals.received / 1_000_000).toFixed(2)}MB / {((totals.total ?? 0) / 1_000_000).toFixed(2)}MB
                </Text>
            </Stack>

            {status === "starting" || status === "running" ? (
                <Center h={400}>
                    <Loader />
                </Center>
            ) : (
                <ScrollArea h={400}>
                    <Stack>
                        {layers.map((layer, i) => {
                            const info = perLayer[i];
                            const pct = info?.total ? Math.floor((info.received / info.total) * 100) : undefined;
                            return (
                                <LayerCard
                                    key={i}
                                    number={i}
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
            )}

            <Button
                leftSection={<IconDownload size="1rem" />}
                fullWidth
                radius="lg"
                mt="lg"
                color="dark"
                disabled={jobId == null || status !== "done"}
                component="a"
                href={`/api/build/download?jobId=${jobId}`}
                target="_blank"
            >
                ダウンロード
            </Button>
        </Modal>
    );
}
