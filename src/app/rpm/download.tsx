'use client';

import { PipPackageCard } from '@/components/PipPackageCard';
import { ProgressEvent, type RpmPackage } from '@/lib/progressBus';
import { Alert, Button, Checkbox, Group, Modal, Progress, ScrollArea, Space, Stack, Text, Textarea, TextInput, Badge, Loader, Center } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconCircleCheck, IconDownload, IconStackFront } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const repoOptions = [
    { value: 'centos-stream-9-baseos', label: 'CentOS Stream 9 BaseOS (official)' },
    { value: 'centos-stream-9-appstream', label: 'CentOS Stream 9 AppStream (official)' },
    { value: 'epel-9-everything', label: 'EPEL 9 Everything' },
];

type Status = 'idle' | 'starting' | 'running' | 'done' | 'error';

type CustomRepo = {
    id?: string;
    label?: string;
    folderName?: string;
    baseUrl: string;
};

function parseCustomRepositories(input: string): { repositories: CustomRepo[]; errors: string[] } {
    const lines = input
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const repositories: CustomRepo[] = [];
    const errors: string[] = [];
    lines.forEach((line, index) => {
        const cols = line.split('|').map((part) => part.trim());
        const [id, label, baseUrl] = cols.length >= 3 ? cols : ['', cols[0] || '', cols[0] || ''];
        if (!baseUrl) {
            errors.push(`${index + 1}行目: URLが空です`);
            return;
        }
        if (!/^https?:\/\//i.test(baseUrl)) {
            errors.push(`${index + 1}行目: URLは http:// または https:// で始めてください`);
            return;
        }
        repositories.push({
            id: id || undefined,
            label: label || undefined,
            folderName: label || id || undefined,
            baseUrl,
        });
    });
    return { repositories, errors };
}

export function DownloadPane() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [jobId, setJobId] = useState<string | null>(null);
    const [status, setStatus] = useState<Status>('idle');
    const [packages, setPackages] = useState<RpmPackage[]>([]);
    const [currentStage, setCurrentStage] = useState('idle');
    const [logs, setLogs] = useState<string[]>([]);
    const [perPackage, setPerPackage] = useState<Record<number, { received: number; total?: number; status: 'waiting' | 'downloading' | 'done' }>>({});
    const [opened, { open, close }] = useDisclosure(false);
    const esRef = useRef<EventSource | null>(null);

    const form = useForm({
        initialValues: {
            packages: '',
            bundleName: 'rpm-offline',
            repositories: repoOptions.map((o) => o.value),
            customRepositories: '',
            resolveDependencies: true,
        },
        validate: {
            packages: (v) => (v.trim() ? null : 'rpm package名を入力してください'),
            repositories: (v, values) => {
                if (v.length) return null;
                const { repositories } = parseCustomRepositories(values.customRepositories);
                return repositories.length ? null : 'リポジトリを1つ以上選択/入力してください';
            },
            customRepositories: (v) => {
                const parsed = parseCustomRepositories(v);
                return parsed.errors[0] ?? null;
            },
        },
    });

    const reset = useCallback(() => {
        setJobId(null);
        setStatus('idle');
        setPackages([]);
        setPerPackage({});
        setCurrentStage('idle');
        setLogs([]);
        esRef.current?.close();
        esRef.current = null;
    }, []);

    useEffect(() => () => esRef.current?.close(), []);

    const handleCloseModal = useCallback(() => {
        const current = jobId;
        close();
        reset();
        if (current) fetch(`/api/build/delete?jobId=${current}`, { method: 'POST' }).catch(() => undefined);
    }, [jobId, close, reset]);

    const onSubmit = async (values: typeof form.values) => {
        setLoading(true);
        setError(null);
        reset();
        setStatus('starting');
        open();

        try {
            const specs = values.packages.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
            const customRepositoriesParsed = parseCustomRepositories(values.customRepositories);
            if (customRepositoriesParsed.errors.length) {
                throw new Error(customRepositoriesParsed.errors[0]);
            }
            const res = await fetch('/api/rpm/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    packages: specs,
                    bundleName: values.bundleName,
                    repositories: values.repositories,
                    customRepositories: customRepositoriesParsed.repositories,
                    resolveDependencies: values.resolveDependencies,
                }),
            });
            if (!res.ok) throw new Error('start failed');
            const { jobId } = await res.json();
            setJobId(jobId);
            setStatus('running');

            const es = new EventSource(`/api/build/progress?jobId=${jobId}`);
            esRef.current = es;
            es.onmessage = (ev) => {
                const data = JSON.parse(ev.data) as ProgressEvent;
                if (data.type === 'stage') { setCurrentStage(data.stage); setStatus(data.stage === 'queued' ? 'starting' : 'running'); }
                if (data.type === 'manifest-resolved') {
                    const list = data.items as RpmPackage[];
                    setPackages(list);
                    const initial: Record<number, { received: number; total?: number; status: 'waiting' | 'downloading' | 'done' }> = {};
                    list.forEach((pkg, idx) => { initial[idx] = { received: 0, total: pkg.size, status: 'waiting' }; });
                    setPerPackage(initial);
                }
                if (data.type === 'item-start' && data.scope === 'rpm-download') {
                    setPerPackage((prev) => ({ ...prev, [data.index]: { ...prev[data.index], status: 'downloading' } }));
                }
                if (data.type === 'item-progress' && data.scope === 'rpm-download') {
                    setPerPackage((prev) => ({ ...prev, [data.index]: { received: data.received, total: data.total ?? prev[data.index]?.total, status: 'downloading' } }));
                }
                if (data.type === 'item-done' && data.scope === 'rpm-download') {
                    setPerPackage((prev) => ({ ...prev, [data.index]: { received: prev[data.index]?.total ?? prev[data.index]?.received ?? 0, total: prev[data.index]?.total, status: 'done' } }));
                }
                if (data.type === 'log') {
                    setLogs((prev) => [...prev.slice(-199), `[${data.level === 'stderr' ? 'stderr' : 'info'}] ${data.message}`]);
                }
                if (data.type === 'error') {
                    setStatus('error');
                    setError(data.message || 'ダウンロードに失敗しました');
                    es.close();
                }
                if (data.type === 'done') {
                    setStatus('done');
                    es.close();
                }
            };
        } catch (err: any) {
            setStatus('error');
            setError(err?.message || 'ダウンロードに失敗しました');
        } finally {
            setLoading(false);
        }
    };

    const totals = useMemo(() => Object.values(perPackage).reduce((acc, item) => ({ received: acc.received + (item.received || 0), total: acc.total + (item.total || 0) }), { received: 0, total: 0 }), [perPackage]);
    const overallPercent = totals.total > 0 ? Math.floor((totals.received / totals.total) * 100) : 0;

    return (
        <div>
            <Alert variant="light" color="yellow" title="注意" radius="lg" my="xl">依存関係解決を有効にすると、対象パッケージが多くなるため時間がかかる場合があります。</Alert>
            <form onSubmit={form.onSubmit(onSubmit)}>
                <Stack>
                    <Textarea label="Package" description="rpm名をスペースまたは改行区切りで入力" minRows={4} autosize size="lg" radius="lg" placeholder="bash\ncoreutils" key={form.key('packages')} {...form.getInputProps('packages')} disabled={loading} />
                    <TextInput label="Bundle name" size="lg" radius="lg" key={form.key('bundleName')} {...form.getInputProps('bundleName')} disabled={loading} />
                    <Checkbox.Group label="Repositories" key={form.key('repositories')} {...form.getInputProps('repositories')}>
                        <Stack mt="xs">{repoOptions.map((repo) => <Checkbox key={repo.value} value={repo.value} label={repo.label} />)}</Stack>
                    </Checkbox.Group>
                    <Textarea
                        label="Custom repositories"
                        description="1行1件。URLのみ、または `id|label|url` 形式で入力"
                        placeholder={'https://download.example.com/rhel/8/BaseOS/x86_64/os/\ncustom-rhel8-appstream|RHEL 8 AppStream|https://download.example.com/rhel/8/AppStream/x86_64/os/'}
                        minRows={3}
                        key={form.key('customRepositories')}
                        {...form.getInputProps('customRepositories')}
                        disabled={loading}
                    />
                    <Checkbox label="依存関係もダウンロード (--resolve --alldeps)" key={form.key('resolveDependencies')} {...form.getInputProps('resolveDependencies', { type: 'checkbox' })} />
                    <Space h="md" />
                    <Button size="lg" radius="lg" type="submit" loading={loading}>Download</Button>
                </Stack>
            </form>
            {error && <Alert color="red" radius="lg" title="エラー" my="lg" variant="light">{error}</Alert>}

            <Modal opened={opened} onClose={handleCloseModal} centered radius="lg" size="lg" transitionProps={{ transition: 'pop' }} withCloseButton>
                <Group justify="space-between"><Group gap="xs"><IconStackFront /><Text fw="bold" size="lg">ダウンロード進捗</Text></Group>{status === 'done' ? <Badge color="green" leftSection={<IconCircleCheck size="1em" />} radius="sm">done</Badge> : <Badge color={status === 'error' ? 'red' : 'gray'} leftSection={status === 'error' ? undefined : <Loader size="1em" color="white" />} radius="sm">{status}</Badge>}</Group>
                {jobId && <Text size="xs" c="dimmed">jobId: {jobId}</Text>}
                <Stack gap={10} py="xs"><Group justify="space-between"><Text fw="bold">全体の進捗</Text><Text>{overallPercent}%</Text></Group><Progress value={overallPercent} size="lg" radius="xl" /><Text size="xs" c="dimmed">{(totals.received / 1_000_000).toFixed(2)}MB / {(totals.total / 1_000_000).toFixed(2)}MB</Text></Stack>
                <Stack gap={8}>
                    <Text size="sm" fw={600}>現在のステージ: {currentStage}</Text>
                    <ScrollArea h={150} type="auto" offsetScrollbars>
                        <Stack gap={2}>
                            {logs.length === 0 ? <Text size="xs" c="dimmed">ログ待機中...</Text> : logs.map((line, idx) => <Text key={`${line}-${idx}`} size="xs" ff="monospace">{line}</Text>)}
                        </Stack>
                    </ScrollArea>
                </Stack>
                <ScrollArea h={260}><Stack gap="sm">{packages.length === 0 && (status === 'starting' || status === 'running') ? <Center h={120}><Loader /></Center> : packages.map((pkg, idx) => <PipPackageCard key={`${pkg.filename}-${idx}`} index={idx} name={pkg.name} version={pkg.version} filename={`${pkg.filename}${pkg.repositoryFolder ? ` • ${pkg.repositoryFolder}` : ''}`} received={perPackage[idx]?.received ?? 0} total={perPackage[idx]?.total} status={perPackage[idx]?.status ?? 'waiting'} />)}</Stack></ScrollArea>
                <Button leftSection={<IconDownload size="1em" />} fullWidth radius="lg" mt="md" color="dark" disabled={!jobId || status !== 'done'} component="a" href={jobId ? `/api/build/download?jobId=${jobId}` : '#'} target="_blank">ダウンロード</Button>
            </Modal>
        </div>
    );
}
