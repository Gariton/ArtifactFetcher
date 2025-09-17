'use client';

import { LayerCard } from "@/components/LayerCard";
import { LockEntry } from "@/lib/progressBus";
import { Alert, Button, Group, Modal, Progress, Space, Stack, Text, ThemeIcon, Title, ScrollArea, Center, Loader, Badge, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { IconBrandNpm, IconCircleCheck, IconDownload, IconStackFront } from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";
import { ProgressEvent } from "@/lib/progressBus";

export default function Npm () {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<null|string>(null);
    const [jobId, setJobId] = useState<string|null>(null);
    const [status, setStatus] = useState<string>("idle");
    const [opened, {open, close}] = useDisclosure(false);
    const [packages, setPackages] = useState<LockEntry[]>([]);
    const [perPackage, setPerPackage] = useState<Record<number, { received: number; total?: number }>>({});
    const esRef = useRef<EventSource | null>(null);
    const form = useForm({
        initialValues: {
            packages: ""
        },
        validate: {
            packages: (v) => v=="" ? "パッケージ名を入力してください" : null
        }
    });

    const reset = () => {
        setJobId(null);
        setStatus("idle");
        setPackages([]);
        setPerPackage({});
        esRef.current?.close();
        esRef.current = null;
    }

    const onSubmit = async (values: typeof form.values) => {
        setLoading(true);
        setError(null);
        reset();
        setStatus("starting");
        open();
        try {
            const specs = values.packages.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
            const res = await fetch('/api/npm/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    specs,
                    bundleName: 'npm-from-specs'
                }),
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
                if (data.type === 'manifest-resolved') setPackages(data.items as LockEntry[]);
                if (data.type === 'item-progress') setPerPackage((prev) => ({ ...prev, [data.index]: { received: data.received, total: data.total } }));
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
    }

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

    const totals = Object.values(perPackage).reduce(
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
                    npm package
                </Title>
                <ThemeIcon
                    variant="transparent"
                    size={60}
                >
                    <IconBrandNpm
                        color="red"
                        style={{width: '70%', height: '70%'}}
                        stroke={1.3}
                    />
                </ThemeIcon>
            </Group>
            <Text
                c="dimmed"
            >
                NPM公式リポジトリから指定したパッケージとそれに依存するパッケージをダウンロードし固めたものをダウンロードします
            </Text>
            <Alert
                variant="light"
                color="yellow"
                title="注意"
                radius="lg"
                my="xl"
            >
                依存関係が多いパッケージは、ダウンロードに時間がかかる場合があります!
            </Alert>

            <form
                onSubmit={form.onSubmit(onSubmit)}
            >
                <Stack>
                    <Textarea
                        label="パッケージ名"
                        description="ダウンロードしたいパッケージ名をスペースまたは改行で区切って入力"
                        size="lg"
                        radius="lg"
                        placeholder="react@^18 axios"
                        key={form.key("packages")}
                        {...form.getInputProps("packages")}
                        disabled={loading}
                        minRows={5}
                        autosize
                    />
                    <Space h="md" />
                    <Button
                        size="lg"
                        radius="lg"
                        type="submit"
                        loading={loading}
                    >
                        Download
                    </Button>
                </Stack>
            </form>

            {jobId && !opened && status !== "idle" && (
                <Button
                    mt="md"
                    variant="light"
                    radius="lg"
                    onClick={open}
                >
                    進捗を再表示
                </Button>
            )}

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
                onClose={() => handleModalClose()}
                centered
                radius="lg"
                size="lg"
                transitionProps={{transition: 'pop'}}
                withCloseButton
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
                        {form.getValues().packages}・{packages.length}items
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
                            {overallPercent || 0}%
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
                            {packages.map((pkg, i) => {
                                const info = perPackage[i];
                                const pct = info?.total ? Math.floor((info.received / info.total) * 100) : undefined;
                                return (
                                    <LayerCard
                                        key={i}
                                        number={i}
                                        status={(pct||0) >= 100 ? "done" : "process"}
                                        progress={pct || 0}
                                        sha={pkg.name}
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
                <Button
                    variant="outline"
                    fullWidth
                    radius="lg"
                    mt="sm"
                    onClick={() => handleModalClose()}
                >
                    閉じる
                </Button>
            </Modal>
        </div>
    );
}
