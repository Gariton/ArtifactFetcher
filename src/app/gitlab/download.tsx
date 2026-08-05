'use client';

import { getEnvironmentVar } from '@/components/actions';
import {
    CarbonAuthPanel,
    CarbonField,
    CarbonFooter,
    CarbonForm,
    CarbonPassword,
    CarbonSection,
    CarbonSubmit,
    carbonClasses,
} from '@/components/CarbonForm';
import { ProgressBanner, ProgressModal, type ProgressItem } from '@/components/ProgressModal';
import type { GitLabArchive, ProgressEvent } from '@/lib/progressBus';
import type { GitLabReleaseOption } from '@/lib/gitlab/downloader';
import { Button, MultiSelect, Select, SegmentedControl, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import {
    IconAlertCircle,
    IconBrandGitlab,
    IconDownload,
    IconFile,
    IconGitBranch,
    IconKey,
    IconSearch,
    IconTag,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export function DownloadPane() {
    const [loading, setLoading] = useState(false);
    const [releasesLoading, setReleasesLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [releasesError, setReleasesError] = useState<string | null>(null);
    const [releases, setReleases] = useState<GitLabReleaseOption[]>([]);
    const [baseUrl, setBaseUrl] = useState('');
    const [configuredToken, setConfiguredToken] = useState(false);
    const [jobId, setJobId] = useState<string | null>(null);
    const [jobTarget, setJobTarget] = useState('archive');
    const [status, setStatus] = useState('idle');
    const [artifacts, setArtifacts] = useState<GitLabArchive[]>([]);
    const [itemProgress, setItemProgress] = useState<Record<number, {
        received: number;
        total?: number;
        status: 'waiting' | 'running' | 'done' | 'error';
        error?: string;
    }>>({});
    const [opened, { open, close }] = useDisclosure(false);
    const eventSourceRef = useRef<EventSource | null>(null);
    const form = useForm({
        mode: 'controlled',
        initialValues: {
            target: 'archive',
            project: '',
            ref: '',
            releaseTag: '',
            assetNames: [] as string[],
            token: '',
        },
        validate: {
            project: (value) => value.trim() ? null : 'プロジェクトIDまたはパスを入力してください',
            releaseTag: (value, values) => values.target !== 'release-asset' || value.trim()
                ? null
                : 'リリースタグを選択してください',
            assetNames: (value, values) => values.target !== 'release-asset' || value.length > 0
                ? null
                : 'リリースアセットを選択してください',
        },
    });

    useEffect(() => {
        getEnvironmentVar().then((env) => {
            setBaseUrl(env.GITLAB_BASE_URL);
            setConfiguredToken(env.GITLAB_TOKEN_CONFIGURED === 'yes');
        });
    }, []);

    const resetProgress = useCallback(() => {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        setJobId(null);
        setStatus('idle');
        setArtifacts([]);
        setItemProgress({});
    }, []);

    const clearReleaseOptions = () => {
        setReleases([]);
        setReleasesError(null);
        form.setFieldValue('releaseTag', '');
        form.setFieldValue('assetNames', []);
    };

    const selectRelease = (tagName: string, availableReleases = releases) => {
        const release = availableReleases.find((item) => item.tagName === tagName);
        form.setFieldValue('releaseTag', tagName);
        form.setFieldValue('assetNames', release?.assets.length === 1 ? [release.assets[0].name] : []);
    };

    const loadReleases = async () => {
        const project = form.getValues().project.trim();
        if (!project) {
            form.setFieldError('project', 'プロジェクトIDまたはパスを入力してください');
            return;
        }
        setReleasesLoading(true);
        clearReleaseOptions();
        try {
            const response = await fetch('/api/gitlab/releases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project,
                    token: form.getValues().token || undefined,
                }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || 'リリース候補の取得に失敗しました');
            const foundReleases = (result.releases || []) as GitLabReleaseOption[];
            setReleases(foundReleases);
            if (foundReleases.length === 1) selectRelease(foundReleases[0].tagName, foundReleases);
            if (foundReleases.length === 0) {
                setReleasesError('direct asset pathが設定されたリリースアセットがありません');
            }
        } catch (caught) {
            setReleasesError(caught instanceof Error ? caught.message : 'リリース候補の取得に失敗しました');
        } finally {
            setReleasesLoading(false);
        }
    };

    const onSubmit = async (values: typeof form.values) => {
        setLoading(true);
        setError(null);
        setJobTarget(values.target);
        resetProgress();
        setStatus('starting');
        open();
        try {
            const response = await fetch('/api/gitlab/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project: values.project.trim(),
                    target: values.target,
                    ref: values.ref.trim() || undefined,
                    releaseTag: values.releaseTag.trim() || undefined,
                    assetNames: values.assetNames,
                    token: values.token || undefined,
                }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || '取得を開始できませんでした');

            setJobId(result.jobId);
            setStatus('running');
            const eventSource = new EventSource(`/api/build/progress?jobId=${result.jobId}`);
            eventSourceRef.current = eventSource;
            eventSource.onmessage = (event) => {
                const data = JSON.parse(event.data) as ProgressEvent;
                if (data.type === 'manifest-resolved') {
                    const resolved = data.items as GitLabArchive[];
                    setArtifacts(resolved);
                    setItemProgress(Object.fromEntries(resolved.map((_item, index) => [index, {
                        received: 0,
                        status: 'waiting' as const,
                    }])));
                }
                if (data.type === 'item-start') {
                    setItemProgress((current) => ({
                        ...current,
                        [data.index]: { received: 0, total: data.total, status: 'running' },
                    }));
                }
                if (data.type === 'item-progress') {
                    setItemProgress((current) => ({
                        ...current,
                        [data.index]: { received: data.received, total: data.total, status: 'running' },
                    }));
                }
                if (data.type === 'item-done') {
                    setItemProgress((current) => ({
                        ...current,
                        [data.index]: {
                            received: current[data.index]?.total || current[data.index]?.received || 0,
                            total: current[data.index]?.total,
                            status: 'done',
                        },
                    }));
                }
                if (data.type === 'item-error') {
                    setItemProgress((current) => ({
                        ...current,
                        [data.index]: {
                            received: current[data.index]?.received || 0,
                            total: current[data.index]?.total,
                            status: 'error',
                            error: data.message,
                        },
                    }));
                }
                if (data.type === 'stage') setStatus(data.stage);
                if (data.type === 'error') {
                    setError(data.message);
                    setItemProgress((current) => Object.fromEntries(
                        Object.entries(current).map(([index, progress]) => [
                            index,
                            progress.status === 'running'
                                ? { ...progress, status: 'error' as const, error: data.message }
                                : progress,
                        ]),
                    ));
                    setStatus('error');
                    eventSource.close();
                }
                if (data.type === 'done') {
                    setStatus('done');
                    eventSource.close();
                }
            };
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'GitLabからの取得に失敗しました');
            setStatus('error');
        } finally {
            setLoading(false);
        }
    };

    const handleClose = useCallback(() => {
        const currentJobId = jobId;
        close();
        resetProgress();
        if (currentJobId && status === 'done') {
            void fetch(`/api/build/delete?jobId=${currentJobId}`, { method: 'POST' });
        }
    }, [jobId, status, close, resetProgress]);

    const state: 'running' | 'done' | 'error' = status === 'done' ? 'done' : status === 'error' ? 'error' : 'running';
    const progressEntries = artifacts.map((_artifact, index) => itemProgress[index] || { received: 0, status: 'waiting' as const });
    const received = progressEntries.reduce((sum, item) => sum + item.received, 0);
    const allTotalsKnown = progressEntries.length > 0 && progressEntries.every((item) => typeof item.total === 'number');
    const total = allTotalsKnown
        ? progressEntries.reduce((sum, item) => sum + (item.total || 0), 0)
        : undefined;
    const percent = total ? Math.min(100, Math.floor((received / total) * 100)) : status === 'done' ? 100 : undefined;
    const sizeMb = (received / 1_000_000).toFixed(1);
    const isReleaseAsset = form.getValues().target === 'release-asset';
    const downloadedReleaseAsset = artifacts[0]?.kind === 'release-asset' || jobTarget === 'release-asset';
    const selectedRelease = releases.find((item) => item.tagName === form.getValues().releaseTag);
    const items: ProgressItem[] = artifacts.map((artifact, index) => {
        const progress = progressEntries[index];
        const itemPercent = progress.total
            ? Math.min(100, Math.floor((progress.received / progress.total) * 100))
            : progress.status === 'done' ? 100 : undefined;
        return {
            key: `${artifact.name}-${index}`,
            label: artifact.name,
            status: progress.status,
            percent: itemPercent,
            meta: progress.status === 'done'
                ? '完了'
                : progress.total
                    ? `${(progress.total / 1_000_000).toFixed(1)}MB`
                    : '待機中',
            error: progress.error,
        };
    });

    return (
        <div>
            <CarbonForm accent="gitlab" onSubmit={form.onSubmit(onSubmit)}>
                <CarbonAuthPanel
                    icon={IconBrandGitlab}
                    title="GitLab接続"
                    sub={baseUrl || 'GITLAB_BASE_URL 未設定'}
                    configured={Boolean(baseUrl)}
                    defaultOpen
                >
                    <CarbonPassword
                        label="Personal Access Token"
                        optional
                        icon={IconKey}
                        value={form.getValues().token}
                        onChange={(value) => {
                            form.setFieldValue('token', value);
                            if (releases.length > 0 || releasesError) clearReleaseOptions();
                        }}
                        placeholder={configuredToken ? 'サーバー設定済み（必要な場合のみ上書き）' : 'glpat-...'}
                        disabled={loading || status !== 'idle'}
                    />
                </CarbonAuthPanel>

                <CarbonSection label="取得対象">
                    <SegmentedControl
                        fullWidth
                        color="gitlab"
                        value={form.getValues().target}
                        onChange={(value) => form.setFieldValue('target', value)}
                        disabled={loading}
                        data={[
                            { label: 'リポジトリ ZIP', value: 'archive' },
                            { label: 'リリースアセット', value: 'release-asset' },
                        ]}
                        mb={16}
                    />
                    <CarbonField
                        label="プロジェクトID / パス"
                        required
                        accent
                        icon={IconBrandGitlab}
                        value={form.getValues().project}
                        onChange={(value) => {
                            form.setFieldValue('project', value);
                            if (releases.length > 0 || releasesError) clearReleaseOptions();
                        }}
                        placeholder="group/subgroup/project または 123"
                        disabled={loading}
                        error={form.errors.project as string | undefined}
                        desc="GitLab上のnamespace付きパス、または数値のProject ID"
                    />
                    {isReleaseAsset ? (
                        <>
                            <div style={{ marginTop: 16 }}>
                                <Button
                                    type="button"
                                    variant="light"
                                    color="gitlab"
                                    leftSection={<IconSearch size="1rem" />}
                                    loading={releasesLoading}
                                    disabled={loading}
                                    onClick={() => void loadReleases()}
                                >
                                    リリース候補を取得
                                </Button>
                            </div>
                            <div style={{ marginTop: 16 }}>
                                <Select
                                    label="リリースタグ"
                                    required
                                    searchable
                                    leftSection={<IconTag size="1rem" />}
                                    placeholder={releasesLoading ? '取得中…' : 'タグを選択'}
                                    data={releases.map((release) => ({
                                        value: release.tagName,
                                        label: release.name && release.name !== release.tagName
                                            ? `${release.tagName} — ${release.name}`
                                            : release.tagName,
                                    }))}
                                    value={form.getValues().releaseTag || null}
                                    onChange={(value) => selectRelease(value || '')}
                                    disabled={loading || releasesLoading || releases.length === 0}
                                    error={form.errors.releaseTag as string | undefined}
                                />
                            </div>
                            <div style={{ marginTop: 16 }}>
                                <MultiSelect
                                    label="アセットファイル（複数選択可）"
                                    required
                                    searchable
                                    leftSection={<IconFile size="1rem" />}
                                    placeholder="ファイルを1件以上選択"
                                    data={(selectedRelease?.assets || []).map((asset) => ({
                                        value: asset.name,
                                        label: asset.fileName !== asset.name
                                            ? `${asset.fileName} — ${asset.name}`
                                            : asset.fileName,
                                    }))}
                                    value={form.getValues().assetNames}
                                    onChange={(value) => form.setFieldValue('assetNames', value)}
                                    disabled={loading || !selectedRelease}
                                    error={form.errors.assetNames as string | undefined}
                                    maxValues={50}
                                    hidePickedOptions
                                />
                            </div>
                            {releasesError && (
                                <div className={carbonClasses.errorText} style={{ marginTop: 10 }}>
                                    <IconAlertCircle size={14} stroke={2} />{releasesError}
                                </div>
                            )}
                        </>
                    ) : (
                        <div style={{ marginTop: 16 }}>
                            <CarbonField
                                label="ref"
                                optional
                                icon={IconGitBranch}
                                value={form.getValues().ref}
                                onChange={(value) => form.setFieldValue('ref', value)}
                                placeholder="main / v1.2.0 / commit SHA"
                                disabled={loading}
                                desc="ブランチ、タグ、コミットSHA。未指定時はデフォルトブランチ"
                            />
                        </div>
                    )}
                </CarbonSection>

                <CarbonFooter hint={isReleaseAsset ? '複数選択時は1つのtarにまとめます' : 'GitLab API経由でZIPを取得します'}>
                    <CarbonSubmit loading={loading} icon={IconDownload}>
                        {isReleaseAsset ? '選択したアセットを取得' : 'ZIPを取得'}
                    </CarbonSubmit>
                </CarbonFooter>
            </CarbonForm>

            {error && status === 'idle' && (
                <div className={carbonClasses.errorText} style={{ marginTop: 16 }}>
                    <IconAlertCircle size={14} stroke={2} />{error}
                </div>
            )}

            <ProgressModal
                opened={opened}
                onClose={handleClose}
                accent="gitlab"
                title={state === 'done' ? '取得完了' : state === 'error' ? '取得に失敗' : 'GitLabから取得中'}
                subtitle={artifacts.length > 1
                    ? `${artifacts.length} files @ ${artifacts[0].ref}`
                    : artifacts[0]
                        ? `${artifacts[0].name} @ ${artifacts[0].ref}`
                        : 'GitLabの取得対象を確認しています…'}
                overallPercent={percent}
                state={state}
                stats={[
                    { value: sizeMb, unit: ' MB', label: '取得サイズ' },
                    { value: artifacts[0]?.ref || '-', label: downloadedReleaseAsset ? 'release' : 'ref' },
                ]}
                items={items}
                banner={state === 'done' ? (
                    <ProgressBanner
                        tone="success"
                        title={downloadedReleaseAsset ? 'リリースアセットを取得しました' : 'ZIPアーカイブを作成しました'}
                        detail={`${sizeMb} MB`}
                    />
                ) : state === 'error' ? (
                    <ProgressBanner tone="error" title="取得できませんでした" detail={error || 'GitLabの設定を確認してください'} />
                ) : undefined}
                footer={state === 'done' ? (
                    <>
                        <Button variant="default" radius="md" onClick={handleClose}>閉じる</Button>
                        <Button
                            color="success"
                            radius="md"
                            leftSection={<IconDownload size="1rem" />}
                            component="a"
                            href={`/api/build/download?jobId=${jobId}`}
                            target="_blank"
                            disabled={!jobId}
                        >
                            {downloadedReleaseAsset
                                ? artifacts.length > 1 ? 'tarをダウンロード' : 'ファイルをダウンロード'
                                : 'ZIPをダウンロード'}
                        </Button>
                    </>
                ) : (
                    <>
                        <Text className="af-mono" fz={12.5} c="var(--af-muted)">
                            {state === 'error' ? '設定を確認してください' : `${sizeMb} MB 受信`}
                        </Text>
                        <Button variant="default" radius="md" onClick={handleClose}>閉じる</Button>
                    </>
                )}
            />
        </div>
    );
}
