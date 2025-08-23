'use client';
import { Alert, Badge, Button, Center, Group, Loader, Modal, Progress, ScrollArea, Space, Stack, Tabs, Text, TextInput, ThemeIcon, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { useRef, useState } from "react";
import { IconBrandDocker, IconCircleCheck, IconDownload, IconStackFront, IconUpload } from "@tabler/icons-react";
import { LayerCard } from "@/components/LayerCard";
import { Layer } from "@/lib/progressBus";
import { ProgressEvent } from "@/lib/progressBus";
import { DownloadPane } from "./download";
import { UploadPane } from "./upload";

export default function Docker() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<null|string>(null);
    const [opened, {open, close}] = useDisclosure(false);
    
    const [jobId, setJobId] = useState<string|null>(null);
    const [status, setStatus] = useState<string>("idle");
    const [layers, setLayers] = useState<Layer[]>([]);
    const [perLayer, setPerLayer] = useState<Record<number, { received: number; total?: number }>>({});
    const esRef = useRef<EventSource | null>(null);
    
    const reset = () => {
        setJobId(null);
        setStatus("idle");
        setLayers([]);
        setPerLayer({});
        esRef.current?.close();
        esRef.current = null;
    }
    
    const form = useForm({
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
    
    const onSubmit = async (values: typeof form.values) => {
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
                if (data.type === 'item-progress') setPerLayer((prev) => ({ ...prev, [data.index]: { received: data.received, total: data.total } }));
                if (data.type === 'stage') setStatus(data.stage);
                if (data.type === 'error') { setStatus('error'); es.close(); }
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
    };
    
    const totals = Object.values(perLayer).reduce(
        (acc, v) => {
            acc.received += v.received || 0; acc.total! += v.total || 0; return acc;
        },
        { received: 0, total: 0 }
    );
    const overallPercent = totals.total! > 0 ? Math.floor((totals.received / totals.total!) * 100) : undefined;
    
    
    return (
        <div>
            <Group
                justify="space-between"
            >
                <Title>
                    Docker Image
                </Title>
                <ThemeIcon
                    variant="transparent"
                    size={60}
                >
                    <IconBrandDocker
                        style={{width: '70%', height: '70%'}}
                        stroke={1.3}
                    />
                </ThemeIcon>
            </Group>
            <Text
                c="dimmed"
            >
                Docker HubのリポジトリからAPIを使用してイメージをダウンロードし、ロードできる形で固めたものをダウンロードします
            </Text>

            <Space h="xl" />

            <Tabs
                variant="pills"
                radius="lg"
                defaultValue="download"
            >
                <Tabs.List>
                    <Tabs.Tab
                        value="download"
                        leftSection={<IconDownload size="1em"/>}
                    >
                        ダウンロード
                    </Tabs.Tab>
                    <Tabs.Tab
                        value="upload"
                        leftSection={<IconUpload size="1em"/>}
                        disabled={process.env.DOCKER_UPLOAD==="false"}
                    >
                        アップロード
                    </Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel
                    value="download"
                >
                    <DownloadPane />
                </Tabs.Panel>
                {process.env.DOCKER_UPLOAD==="true" && (
                    <Tabs.Panel
                        value="upload"
                    >
                        <UploadPane />
                    </Tabs.Panel>
                )}
            </Tabs>
        </div>
    );
}