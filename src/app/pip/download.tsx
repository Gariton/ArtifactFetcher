'use client';

import { PipPackageCard } from '@/components/PipPackageCard';
import { ProgressEvent, type PipPackage } from '@/lib/progressBus';
import { Alert, Badge, Button, Center, Group, Loader, Modal, Progress, ScrollArea, Space, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconCircleCheck, IconDownload, IconStackFront } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Status = 'idle' | 'starting' | 'running' | 'done' | 'error';

type PackageState = {
    received: number;
    total?: number;
    status: 'waiting' | 'downloading' | 'done';
};

type FormValues = {
    packages: string;
    requirementsText: string;
    bundleName: string;
    indexUrl: string;
    extraIndexUrls: string;
    trustedHosts: string;
};

function PipDownloadModal({ opened, onClose, jobId, status, packages, perPackage }: {
    opened: boolean;
    onClose: () => void;
    jobId: string | null;
    status: Status;
    packages: PipPackage[];
    perPackage: Record<number, PackageState>;
}) {
    const totals = useMemo(() => {
        return Object.values(perPackage).reduce((acc, info) => {
            acc.received += info.received || 0;
            acc.total += info.total || 0;
            return acc;
        }, { received: 0, total: 0 });
    }, [perPackage]);
    const overallPercent = totals.total > 0 ? Math.floor((totals.received / totals.total) * 100) : undefined;

    const statusBadge = (() => {
        switch (status) {
            case 'done':
                return (
                    <Badge color="green" leftSection={<IconCircleCheck size="1em" />} radius="sm">
                        done
                    </Badge>
                );
            case 'error':
                return (
                    <Badge color="red" radius="sm">
                        error
                    </Badge>
                );
            case 'running':
            case 'starting':
                return (
                    <Badge color="gray" leftSection={<Loader size="1em" color="white" />} radius="sm">
                        {status}
                    </Badge>
                );
            default:
                return (
                    <Badge color="gray" radius="sm">
                        idle
                    </Badge>
                );
        }
    })();

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            centered
            radius="lg"
            size="lg"
            transitionProps={{ transition: 'pop' }}
            withCloseButton
        >
            <Stack gap="md">
                <Group justify="space-between">
                    <Group gap="xs">
                        <IconStackFront />
                        <Text fw="bold" size="lg">
                            ダウンロード進捗
                        </Text>
                    </Group>
                    {statusBadge}
                </Group>
                {jobId && (
                    <Text size="xs" c="dimmed">
                        jobId: {jobId}
                    </Text>
                )}

                <Stack gap={10} py="xs">
                    <Group justify="space-between">
                        <Text fw="bold">全体の進捗</Text>
                        <Text>{overallPercent ?? 0}%</Text>
                    </Group>
                    <Progress value={overallPercent ?? 0} size="lg" radius="xl" />
                    <Text size="xs" c="dimmed">
                        {(totals.received / 1_000_000).toFixed(2)}MB / {(totals.total / 1_000_000).toFixed(2)}MB
                    </Text>
                </Stack>

                {status === 'starting' || status === 'running' ? (
                    <Center h={420}>
                        <Loader />
                    </Center>
                ) : (
                    <ScrollArea h={420}>
                        <Stack gap="sm">
                            {packages.map((pkg, idx) => {
                                const info = perPackage[idx];
                                return (
                                    <PipPackageCard
                                        key={`${pkg.name}-${pkg.version}-${idx}`}
                                        index={idx}
                                        name={pkg.name}
                                        version={pkg.version}
                                        filename={pkg.filename}
                                        received={info?.received ?? 0}
                                        total={info?.total}
                                        status={info?.status ?? 'waiting'}
                                    />
                                );
                            })}
                        </Stack>
                    </ScrollArea>
                )}

                <Button
                    leftSection={<IconDownload size="1em" />}
                    fullWidth
                    radius="lg"
                    mt="md"
                    color="dark"
                    disabled={!jobId || status !== 'done'}
                    component="a"
                    href={jobId ? `/api/build/download?jobId=${jobId}` : '#'}
                    target="_blank"
                >
                    ダウンロード
                </Button>
            </Stack>
        </Modal>
    );
}

export function DownloadPane() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [jobId, setJobId] = useState<string | null>(null);
    const [status, setStatus] = useState<Status>('idle');
    const [packages, setPackages] = useState<PipPackage[]>([]);
    const [perPackage, setPerPackage] = useState<Record<number, PackageState>>({});
    const [opened, { open, close }] = useDisclosure(false);
    const esRef = useRef<EventSource | null>(null);

    const form = useForm<FormValues>({
        initialValues: {
            packages: '',
            requirementsText: '',
            bundleName: 'pip-offline',
            indexUrl: '',
            extraIndexUrls: '',
            trustedHosts: '',
        },
        validate: {
            packages: (value, values) => {
                if (!value.trim() && !values.requirementsText.trim()) {
                    return 'パッケージ名またはrequirements.txtを入力してください';
                }
                return null;
            },
        },
    });

    const reset = useCallback(() => {
        setJobId(null);
        setStatus('idle');
        setPackages([]);
        setPerPackage({});
        esRef.current?.close();
        esRef.current = null;
    }, []);

    const cleanupAndDelete = useCallback((targetJobId: string | null) => {
        if (!targetJobId) return;
        (async () => {
            try {
                await fetch(`/api/build/delete?jobId=${targetJobId}`, { method: 'POST' });
            } catch (err) {
                console.error('delete failed', err);
            }
        })();
    }, []);

    const handleCloseModal = useCallback(() => {
        const current = jobId;
        close();
        reset();
        cleanupAndDelete(current);
    }, [jobId, close, reset, cleanupAndDelete]);

    useEffect(() => {
        return () => {
            esRef.current?.close();
        };
    }, []);

    const handleProgressEvent = useCallback((data: ProgressEvent) => {
        if (data.type === 'stage') {
            if (data.stage === 'queued') {
                setStatus('starting');
            } else if (data.stage.startsWith('pip')) {
                setStatus('running');
            }
            return;
        }
        if (data.type === 'manifest-resolved') {
            const list = (data.items as PipPackage[]).map((item) => ({
                ...item,
                name: item.name,
                version: item.version,
            }));
            setPackages(list);
            setPerPackage((prev) => {
                const next: Record<number, PackageState> = { ...prev };
                list.forEach((_, idx) => {
                    if (!next[idx]) next[idx] = { received: 0, total: undefined, status: 'waiting' };
                });
                return next;
            });
            return;
        }
        if (data.type === 'item-start' && data.scope === 'pip-download') {
            setPerPackage((prev) => ({
                ...prev,
                [data.index]: {
                    received: prev[data.index]?.received ?? 0,
                    total: data.total ?? prev[data.index]?.total,
                    status: 'downloading',
                },
            }));
            return;
        }
        if (data.type === 'item-progress' && data.scope === 'pip-download') {
            setPerPackage((prev) => ({
                ...prev,
                [data.index]: {
                    received: data.received,
                    total: data.total ?? prev[data.index]?.total,
                    status: 'downloading',
                },
            }));
            return;
        }
        if (data.type === 'item-done' && data.scope === 'pip-download') {
            setPerPackage((prev) => ({
                ...prev,
                [data.index]: {
                    received: prev[data.index]?.total ?? prev[data.index]?.received ?? 0,
                    total: prev[data.index]?.total,
                    status: 'done',
                },
            }));
            return;
        }
        if (data.type === 'error') {
            setStatus('error');
            setError(data.message || 'ダウンロードに失敗しました');
            esRef.current?.close();
            esRef.current = null;
            return;
        }
        if (data.type === 'done') {
            setStatus('done');
            esRef.current?.close();
            esRef.current = null;
            return;
        }
    }, []);

    const onSubmit = async (values: FormValues) => {
        if (!values.packages.trim() && !values.requirementsText.trim()) {
            form.validate();
            return;
        }
        setLoading(true);
        setError(null);
        reset();
        setStatus('starting');
        open();

        const specs = values.packages
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        const payload: Record<string, unknown> = {
            packages: specs.length ? specs : undefined,
            requirementsText: values.requirementsText.trim() || undefined,
            bundleName: values.bundleName.trim() || 'pip-offline',
        };
        if (values.indexUrl.trim()) payload.indexUrl = values.indexUrl.trim();
        const extraIndexUrls = values.extraIndexUrls
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        if (extraIndexUrls.length) payload.extraIndexUrls = extraIndexUrls;
        const trustedHosts = values.trustedHosts
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        if (trustedHosts.length) payload.trustedHosts = trustedHosts;

        try {
            const res = await fetch('/api/pip/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'ジョブの開始に失敗しました');
            }
            const { jobId: newJobId } = await res.json();
            setJobId(newJobId);
            setStatus('running');

            const es = new EventSource(`/api/build/progress?jobId=${newJobId}`);
            esRef.current = es;
            es.onmessage = (ev) => {
                try {
                    const data = JSON.parse(ev.data) as ProgressEvent;
                    handleProgressEvent(data);
                } catch (err) {
                    console.error('failed to parse progress event', err);
                }
            };
            es.onerror = (err) => {
                console.error('SSE error', err);
            };
        } catch (err: any) {
            setError(err?.message || 'ジョブの開始に失敗しました');
            setStatus('error');
            setLoading(false);
            reset();
            return;
        }

        setLoading(false);
    };

    return (
        <div>
            <Alert variant="light" color="yellow" title="注意" radius="lg" my="xl">
                依存パッケージが多い場合は、ダウンロードに時間がかかることがあります。ブラウザを閉じると処理が中断されます。
            </Alert>

            <form onSubmit={form.onSubmit(onSubmit)}>
                <Stack>
                    <Textarea
                        label="パッケージ名"
                        description="例: requests==2.31.0 fastapi"
                        size="lg"
                        radius="lg"
                        placeholder="requests==2.31.0"
                        key={form.key('packages')}
                        {...form.getInputProps('packages')}
                        minRows={5}
                        autosize
                        disabled={loading}
                    />
                    <Textarea
                        label="requirements.txt (任意)"
                        description="requirements.txt の内容を貼り付けるとそのまま使用します"
                        size="lg"
                        radius="lg"
                        placeholder="# requirements.txt"
                        key={form.key('requirementsText')}
                        {...form.getInputProps('requirementsText')}
                        minRows={6}
                        autosize
                        disabled={loading}
                    />
                    <Group grow>
                        <TextInput
                            label="バンドル名"
                            description="出力tarファイル名のベースになります"
                            size="lg"
                            radius="lg"
                            placeholder="pip-offline"
                            key={form.key('bundleName')}
                            {...form.getInputProps('bundleName')}
                            disabled={loading}
                        />
                        <TextInput
                            label="Index URL (任意)"
                            description="社内PyPIなどを利用する場合に指定"
                            size="lg"
                            radius="lg"
                            placeholder="https://pypi.org/simple"
                            key={form.key('indexUrl')}
                            {...form.getInputProps('indexUrl')}
                            disabled={loading}
                        />
                    </Group>

                    <Textarea
                        label="Extra Index URLs (任意)"
                        description="複数指定する場合は改行またはカンマ区切りで入力"
                        size="lg"
                        radius="lg"
                        placeholder={`https://internal.example.com/simple\nhttps://another.example.com/simple`}
                        key={form.key('extraIndexUrls')}
                        {...form.getInputProps('extraIndexUrls')}
                        minRows={3}
                        autosize
                        disabled={loading}
                    />

                    <Textarea
                        label="Trusted Hosts (任意)"
                        description="セルフサイン証明書などでTLS検証をスキップする場合に指定"
                        size="lg"
                        radius="lg"
                        placeholder={`nexus.example.com`}
                        key={form.key('trustedHosts')}
                        {...form.getInputProps('trustedHosts')}
                        minRows={2}
                        autosize
                        disabled={loading}
                    />

                    <Space h="md" />
                    <Button type="submit" size="lg" radius="lg" loading={loading}>
                        ジョブ開始
                    </Button>
                </Stack>
            </form>

            {jobId && !opened && status !== 'idle' && (
                <Button mt="md" variant="light" radius="lg" onClick={open}>
                    進捗を再表示
                </Button>
            )}

            {error && (
                <Alert color="red" radius="lg" title="エラー" my="lg" variant="light">
                    {error}
                </Alert>
            )}

            <PipDownloadModal
                opened={opened}
                onClose={handleCloseModal}
                jobId={jobId}
                status={status}
                packages={packages}
                perPackage={perPackage}
            />
        </div>
    );
}
