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
import { getEnvironmentVar } from "@/components/actions";
import { useRetryableEventSource } from "@/lib/useRetryableEventSource";
import { buildAuthHeaders } from "@/lib/authHeaders";

type FormType = {
    files: File[];
    useManifest: boolean;
    registry: string;
    repo: string;
    tag: string;
    username: string;
    password: string;
}

type EnvType = {
    DOCKER_UPLOAD: string;
    DOCKER_UPLOAD_REGISTRY: string;
    DOCKER_UPLOAD_USERNAME: string;
    DOCKER_UPLOAD_PASSWORD: string;
}

export function UploadPane() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<null|string>(null);
    const [opened, {open, close}] = useDisclosure(false);
    
    const [jobId, setJobId] = useState<string|null>(null);
    const manifests = useMap<string, Layer[]>();
    
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
    const [env, setEnv] = useState<EnvType>({
        DOCKER_UPLOAD: "yes",
        DOCKER_UPLOAD_REGISTRY: "",
        DOCKER_UPLOAD_USERNAME: "",
        DOCKER_UPLOAD_PASSWORD: "",
    });
    
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

    const reset = ({ preserveProgress = false }: { preserveProgress?: boolean } = {}) => {
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
    };
    const form = useForm<FormType>({
        mode: "controlled",
        initialValues: {
            files: [],
            useManifest: true,
            registry: env.DOCKER_UPLOAD_REGISTRY || '',
            repo: "",
            tag: "",
            username: env.DOCKER_UPLOAD_USERNAME || '',
            password: env.DOCKER_UPLOAD_PASSWORD || ''
        },
        validate: {
            registry: (v) => v=="" ? "レジストリを指定してください" : null,
            repo: (v, x) => v==""&&!x.useManifest ? "リポジトリを指定してください" : null,
            tag: (v, x) => v==""&&!x.useManifest ? "タグを指定してください" : null,
        }
    })
    
    const startUpload = useCallback(async (targetIndices?: number[]) => {
        const currentValues = form.getValues();
        const allFiles = currentValues.files;
        const indices = (targetIndices ?? allFiles.map((_, idx) => idx)).filter((idx) => idx >= 0 && idx < allFiles.length && allFiles[idx]);
        const filesToUpload = indices.map((idx) => allFiles[idx]!);

        if (filesToUpload.length === 0) {
            setError("Dockerイメージファイルを選択してください");
            return;
        }

        const registry = currentValues.registry.trim();
        if (!registry) {
            setError("レジストリを指定してください");
            return;
        }
        if (!currentValues.useManifest) {
            if (!currentValues.repo.trim()) {
                setError("リポジトリを指定してください");
                return;
            }
            if (!currentValues.tag.trim()) {
                setError("タグを指定してください");
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
        for (const file of filesToUpload) {
            fd.append('files', file, file.name);
        }

        const qs = new URLSearchParams({
            jobId: newJobId,
            registry,
            repository: currentValues.repo,
            insecureTLS: 'true',
            concurrency: '1',
            tag: currentValues.tag,
            useManifest: String(currentValues.useManifest),
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
    }, [close, form, reset, startSse, stopSse]);

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
        getEnvironmentVar().then(v => {
            setEnv({
                DOCKER_UPLOAD: v.DOCKER_UPLOAD,
                DOCKER_UPLOAD_REGISTRY: v.DOCKER_UPLOAD_REGISTRY,
                DOCKER_UPLOAD_USERNAME: v.DOCKER_UPLOAD_USERNAME,
                DOCKER_UPLOAD_PASSWORD: v.DOCKER_UPLOAD_PASSWORD
            })
            form.setFieldValue("registry", v.DOCKER_UPLOAD_REGISTRY);
            form.setFieldValue("username", v.DOCKER_UPLOAD_USERNAME);
            form.setFieldValue("password", v.DOCKER_UPLOAD_PASSWORD);
        });
        return () => {
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            stopSseRef.current();
            indexMapRef.current = new Map();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const failedCount = Object.values(perFileSnap).filter((state) => state?.status === 'error').length;

    const dockerFiles = form.getValues().files;
    const dockerCompleted = Object.values(perFileSnap).filter((s) => s?.status === "done" || s?.status === "published").length;
    const useManifest = form.getValues().useManifest || dockerFiles.length > 1;

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
                            perFileRef.current = Object.fromEntries(
                                dropped.map((file, idx) => [idx, { received: 0, total: file.size, status: 'waiting' }])
                            ) as Record<number, { received: number; total?: number; status: string }>;
                            setPerFileSnap({ ...perFileRef.current });
                        }}
                        accept={["application/x-tar"]}
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
                                <Dropzone.Idle>Docker イメージ tar をドロップ</Dropzone.Idle>
                                <Dropzone.Accept>ここにドロップ</Dropzone.Accept>
                                <Dropzone.Reject>対応していないファイルです</Dropzone.Reject>
                            </div>
                            <div className={carbonDropzoneClasses.sub}>docker save で出力した .tar ・ 複数可</div>
                        </div>
                    </Dropzone>

                    {dockerFiles.length > 0 && (
                        <CarbonList title={`キュー · ${dockerFiles.length} ファイル`} right={`${dockerCompleted} / ${dockerFiles.length} 完了`}>
                            {dockerFiles.map((file, i) => (
                                <FileItem
                                    key={i}
                                    file={file}
                                    percent={perFileSnap[i]?.status == "done" ? 100 : Math.floor(((perFileSnap[i]?.received ?? 0) / file.size) * 100)}
                                    status={perFileSnap[i]?.status}
                                    onDelete={() => {
                                        if (loading) return;
                                        const currentFiles = form.getValues().files;
                                        const nextFiles = currentFiles.filter((_, idx) => idx !== i);
                                        form.setFieldValue('files', nextFiles);
                                        perFileRef.current = Object.fromEntries(
                                            nextFiles.map((nextFile, index) => [index, { received: 0, total: nextFile.size, status: 'waiting' }])
                                        ) as Record<number, { received: number; total?: number; status: string }>;
                                        setPerFileSnap({ ...perFileRef.current });
                                    }}
                                />
                            ))}
                        </CarbonList>
                    )}

                    <CarbonCheckbox
                        checked={useManifest}
                        onChange={(c) => form.setFieldValue('useManifest', c)}
                        label="manifest の情報を使用する（イメージ名・タグを自動決定）"
                        disabled={dockerFiles.length > 1}
                    />
                    {!useManifest && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <CarbonField label="Repository" icon={IconCube} value={form.getValues().repo} onChange={(v) => form.setFieldValue('repo', v)} placeholder="library/redis" disabled={loading} />
                            <CarbonField label="Tag" value={form.getValues().tag} onChange={(v) => form.setFieldValue('tag', v)} placeholder="7.2" disabled={loading} />
                        </div>
                    )}
                </CarbonSection>

                <CarbonFooter hint={dockerFiles.length ? `${dockerFiles.length} イメージを push します` : '.tar を追加してください'}>
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
