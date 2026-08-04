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
import { Button, SegmentedControl, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle, IconBrandGitlab, IconDownload, IconFile, IconGitBranch, IconKey, IconTag } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export function DownloadPane() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [baseUrl, setBaseUrl] = useState('');
    const [configuredToken, setConfiguredToken] = useState(false);
    const [jobId, setJobId] = useState<string | null>(null);
    const [status, setStatus] = useState('idle');
    const [artifact, setArtifact] = useState<GitLabArchive | null>(null);
    const [received, setReceived] = useState(0);
    const [total, setTotal] = useState<number | undefined>();
    const [opened, { open, close }] = useDisclosure(false);
    const eventSourceRef = useRef<EventSource | null>(null);
    const form = useForm({
        mode: 'controlled',
        initialValues: { target: 'archive', project: '', ref: '', releaseTag: '', assetName: '', token: '' },
        validate: {
            project: (value) => value.trim() ? null : 'プロジェクトIDまたはパスを入力してください',
            releaseTag: (value, values) => values.target !== 'release-asset' || value.trim()
                ? null
                : 'リリースタグを入力してください',
            assetName: (value, values) => values.target !== 'release-asset' || value.trim()
                ? null
                : 'リリースファイル名を入力してください',
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
        setArtifact(null);
        setReceived(0);
        setTotal(undefined);
    }, []);

    const onSubmit = async (values: typeof form.values) => {
        setLoading(true);
        setError(null);
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
                    assetName: values.assetName.trim() || undefined,
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
                if (data.type === 'manifest-resolved') setArtifact((data.items as GitLabArchive[])[0] || null);
                if (data.type === 'item-start') setTotal(data.total);
                if (data.type === 'item-progress') {
                    setReceived(data.received);
                    setTotal(data.total);
                }
                if (data.type === 'stage') setStatus(data.stage);
                if (data.type === 'error') {
                    setError(data.message);
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
    const percent = total ? Math.min(100, Math.floor((received / total) * 100)) : status === 'done' ? 100 : undefined;
    const sizeMb = (received / 1_000_000).toFixed(1);
    const itemStatus = state === 'error' ? 'error' : state === 'done' ? 'done' : received > 0 ? 'running' : 'waiting';
    const isReleaseAsset = form.getValues().target === 'release-asset';
    const items: ProgressItem[] = artifact ? [{
        key: artifact.name,
        label: artifact.name,
        status: itemStatus,
        percent,
        meta: state === 'done' ? '完了' : total ? `${(total / 1_000_000).toFixed(1)}MB` : '取得中',
        error: state === 'error' ? error || undefined : undefined,
    }] : [];

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
                        onChange={(value) => form.setFieldValue('token', value)}
                        placeholder={configuredToken ? 'サーバー設定済み（必要な場合のみ上書き）' : 'glpat-...'}
                        disabled={loading}
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
                            { label: 'リリースファイル', value: 'release-asset' },
                        ]}
                        mb={16}
                    />
                    <CarbonField
                        label="プロジェクトID / パス"
                        required
                        accent
                        icon={IconBrandGitlab}
                        value={form.getValues().project}
                        onChange={(value) => form.setFieldValue('project', value)}
                        placeholder="group/subgroup/project または 123"
                        disabled={loading}
                        error={form.errors.project as string | undefined}
                        desc="GitLab上のnamespace付きパス、または数値のProject ID"
                    />
                    {isReleaseAsset ? (
                        <>
                            <div style={{ marginTop: 16 }}>
                                <CarbonField
                                    label="リリースタグ"
                                    required
                                    icon={IconTag}
                                    value={form.getValues().releaseTag}
                                    onChange={(value) => form.setFieldValue('releaseTag', value)}
                                    placeholder="v1.2.0"
                                    disabled={loading}
                                    error={form.errors.releaseTag as string | undefined}
                                    desc="GitLab Release のタグ名"
                                />
                            </div>
                            <div style={{ marginTop: 16 }}>
                                <CarbonField
                                    label="リリースファイル名"
                                    required
                                    icon={IconFile}
                                    value={form.getValues().assetName}
                                    onChange={(value) => form.setFieldValue('assetName', value)}
                                    placeholder="app-linux-amd64.tar.gz"
                                    disabled={loading}
                                    error={form.errors.assetName as string | undefined}
                                    desc="リリースの Assets > Links に表示される名前（完全一致）"
                                />
                            </div>
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

                <CarbonFooter hint="GitLab API経由で取得し、一時ストレージへ保存します">
                    <CarbonSubmit loading={loading} icon={IconDownload}>
                        {isReleaseAsset ? 'リリースファイルを取得' : 'ZIPを取得'}
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
                subtitle={artifact ? `${artifact.name} @ ${artifact.ref}` : 'GitLabの取得対象を確認しています…'}
                overallPercent={percent}
                state={state}
                stats={[
                    { value: sizeMb, unit: ' MB', label: '取得サイズ' },
                    { value: artifact?.ref || '-', label: isReleaseAsset ? 'release' : 'ref' },
                ]}
                items={items}
                banner={state === 'done' ? (
                    <ProgressBanner
                        tone="success"
                        title={isReleaseAsset ? 'リリースファイルを取得しました' : 'ZIPアーカイブを作成しました'}
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
                            {isReleaseAsset ? 'ファイルをダウンロード' : 'ZIPをダウンロード'}
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
