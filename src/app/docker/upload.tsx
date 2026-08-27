'use client';
import { useForm } from "@mantine/form";
import { useDisclosure, useMap } from "@mantine/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconAlertCircle, IconCloudUpload, IconCube, IconKey, IconRefresh, IconServer, IconX } from "@tabler/icons-react";
import { CarbonForm, CarbonSection, CarbonField, CarbonPassword, CarbonCheckbox, CarbonAuthPanel, CarbonFooter, CarbonSubmit, CarbonGhostButton, CarbonList, carbonClasses, carbonDropzoneClasses } from "@/components/CarbonForm";
import { Layer } from "@/lib/progressBus";
import { ProgressEvent } from "@/lib/progressBus";
import { Dropzone } from "@mantine/dropzone";
import { nanoid } from "nanoid";
import { FileItem } from "@/components/Upload/FileItem";
import { UploadModal } from "@/components/Upload/Modal";
import { useRetryableEventSource } from "@/lib/useRetryableEventSource";
import { buildAuthHeaders } from "@/lib/authHeaders";
import type { DockerPublicRuntimeConfig } from "@/lib/publicRuntimeConfig";

type FormType = {
    files: File[];
    registry: string;
    username: string;
    password: string;
}

type FileTarget = {
    useManifest: boolean;
    repository: string;
    tags: string;
};

const defaultFileTarget = (): FileTarget => ({ useManifest: true, repository: '', tags: '' });
const splitTags = (value: string) => value.split(',').map((tag) => tag.trim()).filter(Boolean);

const DOCKER_ARCHIVE_ACCEPT = {
    'application/x-tar': ['.tar', '.tar.gz'],
    'application/gzip': ['.tar.gz'],
    'application/x-gzip': ['.tar.gz'],
    'application/x-compressed': ['.tar.gz'],
    'application/octet-stream': ['.tar', '.tar.gz'],
};

export function UploadPane({ env }: { env: DockerPublicRuntimeConfig }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<null|string>(null);
    const [opened, {open, close}] = useDisclosure(false);
    
    const [jobId, setJobId] = useState<string|null>(null);
    const manifests = useMap<string, Layer[]>();
    const [fileTargets, setFileTargets] = useState<FileTarget[]>([]);
    
    const perFileRef = useRef<Record<number, { received: number; total?: number; status: string; }>>({});
    const perLayerRef = useRef<Map<string, Record<number, {received: number; total?: number; status: "process"|"done"|"skipped";}>>>(new Map());
    const [perFileSnap, setPerFileSnap] = useState<typeof perFileRef.current>({});
    const [perLayerSnap, setPerLayerSnap] = useState<typeof perLayerRef.current>(new Map());
    const FLUSH_INTERVAL = 250;

    const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
    const indexMapRef = useRef<Map<number, number>>(new Map());
    const scheduleFlush = useCallback(() => {
        if (flushTimerRef.current) return;
        flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            setPerFileSnap({...perFileRef.current})
            setPerLayerSnap(new Map(perLayerRef.current.entries()));
        }, FLUSH_INTERVAL);
    }, []);
    const stopSseRef = useRef<() => void>(() => {});
    const handleSseMessage = useCallback((event: MessageEvent) => {
        try {
            const data = JSON.parse(event.data) as ProgressEvent;
            const resolveIndex = (incomingIndex: number) => {
                const mapped = indexMapRef.current.get(incomingIndex);
                return mapped ?? null;
            };

            if (data.type === 'item-start' && data.scope === 'upload') {
                const targetIndex = resolveIndex(data.index);
                if (targetIndex === null) return;
                perFileRef.current = {
                    ...perFileRef.current,
                    [targetIndex]: {
                        ...perFileRef.current[targetIndex],
                        received: 0,
                        total: data.total ?? perFileRef.current[targetIndex]?.total,
                        status: 'uploading',
                    },
                };
                scheduleFlush();
                return;
            }
            if (data.type === 'item-progress' && data.scope === 'upload') {
                const targetIndex = resolveIndex(data.index);
                if (targetIndex === null) return;
                perFileRef.current = {
                    ...perFileRef.current,
                    [targetIndex]: {
                        ...perFileRef.current[targetIndex],
                        received: data.received,
                        total: data.total ?? perFileRef.current[targetIndex]?.total,
                        status: 'uploading',
                    },
                };
                scheduleFlush();
                return;
            }
            if (data.type === 'item-done' && data.scope === 'upload') {
                const targetIndex = resolveIndex(data.index);
                if (targetIndex === null) return;
                const prev = perFileRef.current[targetIndex];
                perFileRef.current = {
                    ...perFileRef.current,
                    [targetIndex]: {
                        ...prev,
                        received: prev?.total ?? prev?.received ?? 0,
                        status: 'uploaded',
                    },
                };
                scheduleFlush();
                return;
            }

            if (data.type === 'item-start' && data.scope === 'push-image') {
                const targetIndex = resolveIndex(data.index);
                if (targetIndex === null) return;
                perFileRef.current = {
                    ...perFileRef.current,
                    [targetIndex]: {
                        ...perFileRef.current[targetIndex],
                        status: 'pushing',
                    },
                };
                scheduleFlush();
                return;
            }
            if (data.type === 'item-done' && data.scope === 'push-image') {
                const targetIndex = resolveIndex(data.index);
                if (targetIndex === null) return;
                const prev = perFileRef.current[targetIndex];
                perFileRef.current = {
                    ...perFileRef.current,
                    [targetIndex]: {
                        ...prev,
                        status: 'done',
                        received: prev?.total ?? prev?.received ?? 0,
                    },
                };
                scheduleFlush();
                return;
            }
            if (data.type === 'item-error' && data.scope === 'push-image') {
                const targetIndex = resolveIndex(data.index);
                if (targetIndex === null) return;
                const prev = perFileRef.current[targetIndex];
                perFileRef.current = {
                    ...perFileRef.current,
                    [targetIndex]: {
                        ...prev,
                        status: 'error',
                    },
                };
                setError((current) => current || data.message || 'アップロードに失敗しました');
                scheduleFlush();
                return;
            }

            if (data.type === 'repo-tag-resolved') {
                open();
                data.items.forEach(({ repository, tag }) => {
                    manifests.set(`${repository}@${tag}`, []);
                    perLayerRef.current.set(`${repository}@${tag}`, {});
                });
                scheduleFlush();
                return;
            }
            if (data.type === 'manifest-resolved') {
                if (data.manifestName) {
                    manifests.set(data.manifestName, data.items as Layer[]);
                    perLayerRef.current.set(
                        data.manifestName,
                        data.items.map(() => ({ received: 0, total: 0, status: 'process' }))
                    );
                    scheduleFlush();
                }
                return;
            }
            if (data.type === 'item-start' && data.scope === 'push-item') {
                if (data.manifestName) {
                    const record = perLayerRef.current.get(data.manifestName) ?? {};
                    perLayerRef.current.set(data.manifestName, {
                        ...record,
                        [data.index]: { received: 0, total: data.total, status: 'process' },
                    });
                    scheduleFlush();
                }
                return;
            }
            if (data.type === 'item-progress' && data.scope === 'push-item') {
                if (data.manifestName) {
                    const record = perLayerRef.current.get(data.manifestName) ?? {};
                    perLayerRef.current.set(data.manifestName, {
                        ...record,
                        [data.index]: { received: data.received, total: data.total, status: 'process' },
                    });
                    scheduleFlush();
                }
                return;
            }
            if (data.type === 'item-done' && data.scope === 'push-item') {
                if (data.manifestName) {
                    const record = perLayerRef.current.get(data.manifestName) ?? {};
                    perLayerRef.current.set(data.manifestName, {
                        ...record,
                        [data.index]: { ...record[data.index], status: 'done' },
                    });
                    scheduleFlush();
                }
                return;
            }
            if (data.type === 'item-skip' && data.scope === 'push-item') {
                if (data.manifestName) {
                    const record = perLayerRef.current.get(data.manifestName) ?? {};
                    perLayerRef.current.set(data.manifestName, {
                        ...record,
                        [data.index]: { received: 100, total: 100, status: 'skipped' },
                    });
                    scheduleFlush();
                }
                return;
            }
            if (data.type === 'error-summary') {
                const failedNames = data.failures.map((f) => f.name).join(', ');
                setError(failedNames ? `一部のイメージでエラー: ${failedNames}` : '一部のイメージでエラーが発生しました');
                scheduleFlush();
                return;
            }
            if (data.type === 'error') {
                setLoading(false);
                setError(data.message || 'アップロードに失敗しました');
                perFileRef.current = Object.fromEntries(
                    Object.entries(perFileRef.current).map(([key, value]) => [Number(key), { ...value, status: value.status === 'done' ? 'done' : 'error' }])
                );
                scheduleFlush();
                stopSseRef.current();
                indexMapRef.current = new Map();
                return;
            }
            if (data.type === 'done') {
                setLoading(false);
                stopSseRef.current();
                indexMapRef.current = new Map();
                scheduleFlush();
                return;
            }
        } catch (err) {
            console.error('SSE payload parse failed', err);
        }
    }, [manifests, open, scheduleFlush]);

    const { start: startSse, stop: stopSse } = useRetryableEventSource({
        onMessage: handleSseMessage,
        onOpen: () => {
            console.debug("SSE open");
        },
        onError: (event) => {
            console.error("SSE error", event);
        },
        notificationId: "docker-upload-sse",
        notificationLabel: "Dockerアップロード進捗"
    });

    useEffect(() => {
        stopSseRef.current = stopSse;
    }, [stopSse]);

    const reset = useCallback(({ preserveProgress = false }: { preserveProgress?: boolean } = {}) => {
        setJobId(null);
        if (!preserveProgress) {
            manifests.clear();
            perLayerRef.current = new Map();
            setPerLayerSnap(new Map());
            perFileRef.current = {};
            setPerFileSnap({});
        } else {
            setPerLayerSnap(new Map(perLayerRef.current.entries()));
            setPerFileSnap({ ...perFileRef.current });
        }
        stopSse();
        indexMapRef.current = new Map();
    }, [manifests, stopSse]);
    const form = useForm<FormType>({
        mode: "controlled",
        initialValues: {
            files: [],
            registry: env.DOCKER_UPLOAD_REGISTRY || '',
            username: '',
            password: ''
        },
        validate: {
            registry: (v) => v=="" ? "レジストリを指定してください" : null,
        }
    })
    
    const startUpload = useCallback(async (targetIndices?: number[]) => {
        const currentValues = form.getValues();
        const allFiles = currentValues.files;
        const indices = (targetIndices ?? allFiles.map((_, idx) => idx)).filter((idx) => idx >= 0 && idx < allFiles.length && allFiles[idx]);
        const filesToUpload = indices.map((idx) => allFiles[idx]!);
        const targetsToUpload = indices.map((idx) => fileTargets[idx] ?? defaultFileTarget());

        if (filesToUpload.length === 0) {
            setError("Dockerイメージファイルを選択してください");
            return;
        }

        const registry = currentValues.registry.trim();
        if (!registry) {
            setError("レジストリを指定してください");
            return;
        }
        for (let i = 0; i < targetsToUpload.length; i++) {
            const target = targetsToUpload[i]!;
            if (!target.useManifest && !target.repository.trim()) {
                setError(`${filesToUpload[i]!.name}: リポジトリを指定してください`);
                return;
            }
            if (!target.useManifest && splitTags(target.tags).length === 0) {
                setError(`${filesToUpload[i]!.name}: タグを1つ以上指定してください`);
                return;
            }
        }

        setLoading(true);
        setError(null);

        const preserveProgress = Boolean(targetIndices && targetIndices.length);
        reset({ preserveProgress });
        if (!preserveProgress) {
            close();
        }

        const nextPerFile: Record<number, { received: number; total?: number; status: string }> = preserveProgress ? { ...perFileRef.current } : {};
        if (preserveProgress) {
            for (const idx of indices) {
                const file = allFiles[idx];
                if (!file) continue;
                nextPerFile[idx] = { received: 0, total: file.size, status: 'waiting' };
            }
        } else {
            for (let i = 0; i < allFiles.length; i++) {
                const file = allFiles[i];
                if (!file) continue;
                nextPerFile[i] = { received: 0, total: file.size, status: 'waiting' };
            }
        }
        perFileRef.current = nextPerFile;
        setPerFileSnap({ ...perFileRef.current });

        const newJobId = nanoid();
        setJobId(newJobId);

        indexMapRef.current = new Map(indices.map((originalIndex, order) => [order, originalIndex]));
        startSse(`/api/build/progress?jobId=${newJobId}`);

        const fd = new FormData();
        fd.append('targets', JSON.stringify(targetsToUpload.map((target) => ({
            useManifest: target.useManifest,
            repository: target.repository.trim(),
            tags: splitTags(target.tags),
        }))));
        for (const file of filesToUpload) {
            fd.append('files', file, file.name);
        }

        const qs = new URLSearchParams({
            jobId: newJobId,
            registry,
            insecureTLS: 'true',
            concurrency: '1',
        });

        try {
            const res = await fetch(`/api/docker/upload-multi?${qs.toString()}`, {
                method: 'POST',
                headers: buildAuthHeaders({ username: currentValues.username, password: currentValues.password }),
                body: fd,
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || 'push start failed');
            }
        } catch (e: any) {
            setLoading(false);
            setError(e?.message || 'アップロードに失敗しました');
            stopSse();
            indexMapRef.current = new Map();
            setJobId(null);
            const failedEntries = Object.fromEntries(indices.map((idx) => [idx, { ...perFileRef.current[idx], status: 'error' }])) as Record<number, { received: number; total?: number; status: string }>;
            perFileRef.current = {
                ...perFileRef.current,
                ...failedEntries,
            };
            setPerFileSnap({ ...perFileRef.current });
        }
    }, [close, fileTargets, form, reset, startSse, stopSse]);

    const onSubmit = form.onSubmit(() => {
        void startUpload();
    });

    const handleRetryFailed = useCallback(() => {
        if (loading) return;
        const failedIndices = Object.entries(perFileRef.current)
            .filter(([, value]) => value?.status === 'error')
            .map(([key]) => Number(key));
        if (failedIndices.length === 0) return;
        void startUpload(failedIndices);
    }, [loading, startUpload]);

    useEffect(() => {
        return () => {
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            stopSseRef.current();
            indexMapRef.current = new Map();
        };
    }, []);

    const failedCount = Object.values(perFileSnap).filter((state) => state?.status === 'error').length;

    const dockerFiles = form.getValues().files;
    const dockerCompleted = Object.values(perFileSnap).filter((s) => s?.status === "done" || s?.status === "published").length;

    const updateFileTarget = (index: number, patch: Partial<FileTarget>) => {
        setFileTargets((current) => current.map((target, targetIndex) => targetIndex === index ? { ...target, ...patch } : target));
    };

    return (
        <div>
            <CarbonForm accent="docker" onSubmit={onSubmit}>
                <CarbonAuthPanel
                    icon={IconServer}
                    title="アップロード先"
                    sub={`${form.getValues().registry?.trim() || 'レジストリ未設定'} · ${form.getValues().username ? '認証あり' : '認証なし'}`}
                    configured={Boolean(form.getValues().registry?.trim())}
                    defaultOpen
                >
                    <CarbonField label="Registry" icon={IconServer} value={form.getValues().registry} onChange={(v) => form.setFieldValue('registry', v)} placeholder="https://docker-hub-clone.example.com" disabled={loading} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <CarbonField label="Username" optional small value={form.getValues().username} onChange={(v) => form.setFieldValue('username', v)} placeholder="username" disabled={loading} />
                        <CarbonPassword label="Password" optional icon={IconKey} value={form.getValues().password} onChange={(v) => form.setFieldValue('password', v)} placeholder="password" disabled={loading} />
                    </div>
                </CarbonAuthPanel>

                <CarbonSection>
                    <Dropzone
                        onDrop={(dropped) => {
                            if (loading) return;
                            form.setFieldValue('files', dropped);
                            setFileTargets(dropped.map(defaultFileTarget));
                            perFileRef.current = Object.fromEntries(
                                dropped.map((file, idx) => [idx, { received: 0, total: file.size, status: 'waiting' }])
                            ) as Record<number, { received: number; total?: number; status: string }>;
                            setPerFileSnap({ ...perFileRef.current });
                        }}
                        accept={DOCKER_ARCHIVE_ACCEPT}
                        p="xl"
                        className={carbonDropzoneClasses.root}
                    >
                        <div style={{ pointerEvents: "none", textAlign: "center" }}>
                            <span className={carbonDropzoneClasses.icon}>
                                <Dropzone.Idle><IconCloudUpload size={26} stroke={1.7} /></Dropzone.Idle>
                                <Dropzone.Accept><IconCloudUpload size={26} stroke={1.7} /></Dropzone.Accept>
                                <Dropzone.Reject><IconX size={26} stroke={1.7} /></Dropzone.Reject>
                            </span>
                            <div className={carbonDropzoneClasses.title}>
                                <Dropzone.Idle>Docker イメージ tar / tar.gz をドロップ</Dropzone.Idle>
                                <Dropzone.Accept>ここにドロップ</Dropzone.Accept>
                                <Dropzone.Reject>対応していないファイルです</Dropzone.Reject>
                            </div>
                            <div className={carbonDropzoneClasses.sub}>docker save の .tar または gzip 圧縮した .tar.gz ・ 複数可</div>
                        </div>
                    </Dropzone>

                    {dockerFiles.length > 0 && (
                        <CarbonList title={`キュー · ${dockerFiles.length} ファイル`} right={`${dockerCompleted} / ${dockerFiles.length} 完了`}>
                            {dockerFiles.map((file, i) => (
                                <div key={`${file.name}-${file.lastModified}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 16, borderBottom: i < dockerFiles.length - 1 ? '1px solid var(--af-border)' : undefined }}>
                                    <FileItem
                                        file={file}
                                        percent={perFileSnap[i]?.status == "done" ? 100 : Math.floor(((perFileSnap[i]?.received ?? 0) / file.size) * 100)}
                                        status={perFileSnap[i]?.status}
                                        onDelete={() => {
                                            if (loading) return;
                                            const currentFiles = form.getValues().files;
                                            const nextFiles = currentFiles.filter((_, idx) => idx !== i);
                                            form.setFieldValue('files', nextFiles);
                                            setFileTargets((current) => current.filter((_, idx) => idx !== i));
                                            perFileRef.current = Object.fromEntries(
                                                nextFiles.map((nextFile, index) => [index, { received: 0, total: nextFile.size, status: 'waiting' }])
                                            ) as Record<number, { received: number; total?: number; status: string }>;
                                            setPerFileSnap({ ...perFileRef.current });
                                        }}
                                    />
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 8px' }}>
                                        <CarbonCheckbox
                                            checked={fileTargets[i]?.useManifest ?? true}
                                            onChange={(checked) => updateFileTarget(i, { useManifest: checked })}
                                            label="manifest のイメージ名・タグを使用する"
                                            disabled={loading}
                                        />
                                        {(fileTargets[i]?.useManifest ?? true) ? (
                                            <CarbonField
                                                label="追加タグ"
                                                optional
                                                value={fileTargets[i]?.tags ?? ''}
                                                onChange={(value) => updateFileTarget(i, { tags: value })}
                                                placeholder="latest, stable"
                                                desc="manifest のタグに加え、カンマ区切りで複数指定できます"
                                                disabled={loading}
                                            />
                                        ) : (
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                                <CarbonField
                                                    label="Repository"
                                                    required
                                                    icon={IconCube}
                                                    value={fileTargets[i]?.repository ?? ''}
                                                    onChange={(value) => updateFileTarget(i, { repository: value })}
                                                    placeholder="library/redis"
                                                    disabled={loading}
                                                />
                                                <CarbonField
                                                    label="Tags"
                                                    required
                                                    value={fileTargets[i]?.tags ?? ''}
                                                    onChange={(value) => updateFileTarget(i, { tags: value })}
                                                    placeholder="7.2, latest, stable"
                                                    desc="カンマ区切りで複数指定できます"
                                                    disabled={loading}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </CarbonList>
                    )}
                </CarbonSection>

                <CarbonFooter hint={dockerFiles.length ? `${dockerFiles.length} イメージを push します` : '.tar / .tar.gz を追加してください'}>
                    {failedCount > 0 && !loading && (
                        <CarbonGhostButton onClick={handleRetryFailed}><IconRefresh size={15} /> 失敗を再試行</CarbonGhostButton>
                    )}
                    <CarbonSubmit loading={loading} icon={IconCloudUpload}>アップロード実行</CarbonSubmit>
                </CarbonFooter>
            </CarbonForm>

            {error && (
                <div className={carbonClasses.errorText} style={{ marginTop: 16 }}>
                    <IconAlertCircle size={14} stroke={2} />{error}
                </div>
            )}

            <UploadModal
                opened={opened}
                onClose={()=>{
                    close();
                    reset();
                }}
                jobId={jobId}
                manifests={manifests}
                perLayer={perLayerSnap}
            />
        </div>
    );
}
