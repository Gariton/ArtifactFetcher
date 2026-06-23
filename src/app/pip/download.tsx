'use client';

import { ProgressEvent, type PipPackage } from '@/lib/progressBus';
import { Button, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle, IconBox, IconDownload, IconWorld } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProgressBanner, ProgressModal, type ProgressItem } from '@/components/ProgressModal';
import { CarbonForm, CarbonSection, CarbonField, CarbonTextarea, CarbonAuthPanel, CarbonFooter, CarbonSubmit, CarbonGhostButton, carbonClasses } from '@/components/CarbonForm';

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
    const totals = Object.values(perPackage).reduce((acc, info) => {
        acc.received += info.received || 0;
        acc.total += info.total || 0;
        return acc;
    }, { received: 0, total: 0 });
    const indeterminate = status === 'starting' || status === 'running' || packages.length === 0;
    const overallPercent = totals.total > 0 ? Math.floor((totals.received / totals.total) * 100) : (status === 'done' ? 100 : 0);
    const state: 'running' | 'done' | 'error' = status === 'done' ? 'done' : status === 'error' ? 'error' : 'running';

    const items: ProgressItem[] = packages.map((pkg, idx) => {
        const info = perPackage[idx];
        const raw = info?.status ?? 'waiting';
        const pct = info?.total ? Math.floor(((info.received || 0) / info.total) * 100) : 0;
        const st: ProgressItem['status'] =
            raw === 'done' ? 'done' :
            (info?.received ?? 0) > 0 || raw === 'downloading' ? 'running' : 'waiting';
        return {
            key: `${pkg.name}-${idx}`,
            label: `${pkg.name} ${pkg.version}`,
            status: st,
            percent: pct,
            meta: st === 'done' ? '完了' : info?.total ? `${(info.total / 1_000_000).toFixed(1)}MB` : '待機',
        };
    });
    const doneCount = items.filter((i) => i.status === 'done').length;

    return (
        <ProgressModal
            opened={opened}
            onClose={onClose}
            accent="pip"
            title={state === 'done' ? '取得完了' : state === 'error' ? '取得に失敗' : '取得中'}
            subtitle={`${packages.length} packages`}
            overallPercent={indeterminate ? undefined : overallPercent}
            state={state}
            stats={[
                { value: doneCount, unit: `/${packages.length}`, label: '完了 / 全体', accent: state === 'done' },
                { value: (totals.received / 1_000_000).toFixed(0), unit: ' MB', label: '取得サイズ' },
                { value: packages.length, label: 'パッケージ' },
            ]}
            items={items}
            banner={state === 'done' ? (
                <ProgressBanner tone="success" title={`${packages.length} パッケージを取得しました`} detail={`${(totals.received / 1_000_000).toFixed(1)} MB`} />
            ) : undefined}
            footer={state === 'done' ? (
                <>
                    <Button variant="default" radius="md" onClick={onClose}>閉じる</Button>
                    <Button
                        color="success"
                        radius="md"
                        leftSection={<IconDownload size="1rem" />}
                        component="a"
                        href={jobId ? `/api/build/download?jobId=${jobId}` : '#'}
                        target="_blank"
                        disabled={!jobId}
                    >
                        アーカイブをダウンロード
                    </Button>
                </>
            ) : (
                <>
                    <Text className="af-mono" fz={12.5} c="var(--af-muted)">
                        {indeterminate ? '依存を解決しています…' : `${doneCount} / ${packages.length}`}
                    </Text>
                    <Button variant="default" radius="md" onClick={onClose}>キャンセル</Button>
                </>
            )}
        />
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
        mode: 'controlled',
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
            <CarbonForm accent="pip" onSubmit={form.onSubmit(onSubmit)}>
                <CarbonAuthPanel
                    icon={IconWorld}
                    title="インデックス / 設定"
                    sub={`${form.getValues().indexUrl?.trim() || 'pypi.org/simple'} · ${form.getValues().trustedHosts?.trim() ? 'TLS 検証スキップあり' : 'TLS 検証 ON'}`}
                    configured={Boolean(form.getValues().indexUrl?.trim())}
                    defaultOpen={false}
                >
                    <CarbonField
                        label="Index URL"
                        optional
                        small
                        icon={IconWorld}
                        value={form.getValues().indexUrl}
                        onChange={(val) => form.setFieldValue('indexUrl', val)}
                        placeholder="https://pypi.org/simple"
                        disabled={loading}
                        desc="社内 PyPI などを利用する場合に指定"
                    />
                    <CarbonTextarea
                        label="Extra Index URLs"
                        optional
                        small
                        value={form.getValues().extraIndexUrls}
                        onChange={(val) => form.setFieldValue('extraIndexUrls', val)}
                        placeholder={`https://internal.example.com/simple\nhttps://another.example.com/simple`}
                        rows={3}
                        disabled={loading}
                        desc="複数指定する場合は改行またはカンマ区切り"
                    />
                    <CarbonTextarea
                        label="Trusted Hosts"
                        optional
                        small
                        value={form.getValues().trustedHosts}
                        onChange={(val) => form.setFieldValue('trustedHosts', val)}
                        placeholder="nexus.example.com"
                        rows={2}
                        disabled={loading}
                        desc="自己署名証明書で TLS 検証をスキップする場合に指定"
                    />
                </CarbonAuthPanel>

                <CarbonSection label="取得対象">
                    <CarbonTextarea
                        label={<>パッケージ名 <span className={carbonClasses.required}>必須</span></>}
                        value={form.getValues().packages}
                        onChange={(val) => form.setFieldValue('packages', val)}
                        placeholder="requests==2.31.0 fastapi"
                        rows={5}
                        disabled={loading}
                        desc="例: requests==2.31.0 fastapi"
                        error={form.errors.packages as string | undefined}
                    />
                    <CarbonTextarea
                        label="requirements.txt"
                        optional
                        value={form.getValues().requirementsText}
                        onChange={(val) => form.setFieldValue('requirementsText', val)}
                        placeholder="# requirements.txt"
                        rows={6}
                        disabled={loading}
                        desc="内容を貼り付けるとそのまま使用します"
                    />
                    <CarbonField
                        label="バンドル名"
                        optional
                        icon={IconBox}
                        value={form.getValues().bundleName}
                        onChange={(val) => form.setFieldValue('bundleName', val)}
                        placeholder="pip-offline"
                        disabled={loading}
                        desc="出力 tar ファイル名のベースになります"
                    />
                </CarbonSection>

                <CarbonFooter hint="依存込みで取得して tar 化します">
                    {jobId && status !== 'idle' && <CarbonGhostButton onClick={open}>進捗を表示</CarbonGhostButton>}
                    <CarbonSubmit loading={loading}>取得を開始</CarbonSubmit>
                </CarbonFooter>
            </CarbonForm>

            {error && (
                <div className={carbonClasses.errorText} style={{ marginTop: 16 }}>
                    <IconAlertCircle size={14} stroke={2} />{error}
                </div>
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
