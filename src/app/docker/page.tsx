'use client';
import { Alert, Badge, Button, Center, Group, Loader, Modal, Progress, ScrollArea, Space, Stack, Text, TextInput, ThemeIcon, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { useRef, useState } from "react";
import { IconBrandDocker, IconCircleCheck, IconDownload, IconStackFront } from "@tabler/icons-react";
import { LayerCard } from "@/components/LayerCard";
import { Layer } from "@/lib/progressBus";
import { ProgressEvent } from "@/lib/progressBus";

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
            platform: ""
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
                        color="blue"
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
            
            <Modal
                opened={opened}
                onClose={()=>{
                    close();
                    reset();
                }}
                centered
                radius="lg"
                size="lg"
                transitionProps={{transition: "pop"}}
                withCloseButton={false}
            >
                <Group
                    justify="space-between"
                >
                    <Group
                        gap="xs"
                    >
                        <IconStackFront />
                        <Text
                            fw="bold"
                            size="lg"
                        >
                            ダウンロード進捗
                        </Text>
                    </Group>
                    <Text
                        size="xs"
                    >
                        {jobId}
                    </Text>
                </Group>

                <Group
                    justify="space-between"
                >
                    <Text
                        size="sm"
                        c="dimmed"
                    >
                        {form.getValues().repo}:{form.getValues().tag}・{layers.length}Layers
                    </Text>
                    {status=="done" ? (
                        <Badge
                            leftSection={<IconCircleCheck size="1em"/>}
                            color="green"
                            radius="sm"
                        >
                            done
                        </Badge>
                    ):(
                        <Badge
                            leftSection={<Loader size="1em" color="white"/>}
                            color="gray"
                            radius="sm"
                        >
                            {status}
                        </Badge>
                    )}
                </Group>

                <Stack
                    py="md"
                    gap={10}
                >
                    <Group
                        justify="space-between"
                    >
                        <Text
                            fw="bold"
                        >
                            全体の進捗
                        </Text>
                        <Text>
                            {overallPercent}%
                        </Text>
                    </Group>
                    <Progress
                        value={overallPercent || 0}
                        size="lg"
                    />
                    <Text
                        color="dimmed"
                        size="xs"
                    >
                        {(totals.received / 1_000_000).toFixed(2)}MB / {((totals.total ?? 0) / 1_000_000).toFixed(2)}MB
                    </Text>
                </Stack>

                {status=="starting"||status=="running" ? (
                    <Center
                        h={400}
                    >
                        <Loader />
                    </Center>
                ) : (
                    <ScrollArea
                        h={400}
                    >
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
                                    />
                                )
                            })}
                        </Stack>
                    </ScrollArea>
                )}

                <Button
                    leftSection={<IconDownload size="1rem"/>}
                    fullWidth
                    radius="lg"
                    mt="lg"
                    color="dark"
                    disabled={jobId==null || status!="done"}
                    component="a"
                    href={`/api/build/download?jobId=${jobId}`}
                    target="_blank"
                >
                    ダウンロード
                </Button>
            </Modal>
        </div>
    );
}