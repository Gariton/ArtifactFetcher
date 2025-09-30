'use client';
import { Accordion, Alert, Button, Checkbox, Group, PasswordInput, Space, Stack, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure, useMap } from "@mantine/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconCloudCog, IconCloudUpload, IconDownload, IconRefresh, IconX } from "@tabler/icons-react";
import { Layer } from "@/lib/progressBus";
import { ProgressEvent } from "@/lib/progressBus";
import { Dropzone } from "@mantine/dropzone";
import { nanoid } from "nanoid";
import { FileItem } from "@/components/Upload/FileItem";
import { UploadModal } from "@/components/Upload/Modal";
import { getEnvironmentVar } from "@/components/actions";
import { useRetryableEventSource } from "@/lib/useRetryableEventSource";

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
        mode: "uncontrolled",
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
        if (currentValues.username) qs.set('username', currentValues.username);
        if (currentValues.password) qs.set('password', currentValues.password);

        try {
            const res = await fetch(`/api/docker/upload-multi?${qs.toString()}`, {
                method: 'POST',
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

    return (
        <div>
            <Alert
                variant="light"
                color="yellow"
                title="注意"
                radius="lg"
                my="xl"
            >
                大きなイメージの場合、アップロードに時間がかかる場合があります!
            </Alert>

            <form
                onSubmit={onSubmit}
            >
                <Stack>
                    <Accordion
                        variant="separated"
                        radius="lg"
                    >
                        <Accordion.Item
                            value="upload_settings"
                            key="upload_settings"
                        >
                            <Accordion.Control
                                icon={<IconCloudCog size="1em"/>}
                            >
                                アップロード先設定
                            </Accordion.Control>
                            <Accordion.Panel>
                                <Stack>
                                    <TextInput
                                        label="Registry"
                                        description="アップロード先のレジストリを入力"
                                        size="lg"
                                        radius="lg"
                                        placeholder="https://docker-hub-clone.example.com"
                                        key={form.key("registry")}
                                        {...form.getInputProps("registry")}
                                        disabled={loading}
                                    />
                                    <TextInput
                                        label="Username"
                                        size="lg"
                                        radius="lg"
                                        placeholder="username"
                                        key={form.key("username")}
                                        {...form.getInputProps("username")}
                                        disabled={loading}
                                    />
                                    <PasswordInput
                                        label="Password"
                                        size="lg"
                                        radius="lg"
                                        placeholder="password"
                                        key={form.key("password")}
                                        {...form.getInputProps("password")}
                                        disabled={loading}
                                    />
                                </Stack>
                            </Accordion.Panel>
                        </Accordion.Item>
                    </Accordion>
                    <Dropzone
                        onDrop={(files) => {
                            if (loading) return;
                            form.setFieldValue('files', files);
                            perFileRef.current = Object.fromEntries(
                                files.map((file, idx) => [idx, { received: 0, total: file.size, status: 'waiting' }])
                            ) as Record<number, { received: number; total?: number; status: string }>;
                            setPerFileSnap({ ...perFileRef.current });
                        }}
                        radius="lg"
                        accept={["application/x-tar"]}
                        p="xl"
                    >
                        <div
                            style={{pointerEvents: "none"}}
                        >
                            <Group justify="center">
                                <Dropzone.Accept>
                                    <IconDownload size={50} color={"blue.6"} stroke={1.5} />
                                </Dropzone.Accept>
                                <Dropzone.Reject>
                                    <IconX size={50} color={"red.6"} stroke={1.5} />
                                </Dropzone.Reject>
                                <Dropzone.Idle>
                                    <IconCloudUpload size={50} stroke={1.5}/>
                                </Dropzone.Idle>
                            </Group>

                            <Text ta="center" fw={700} fz="lg" mt="xl">
                                <Dropzone.Accept>ここにファイルをドロップ</Dropzone.Accept>
                                <Dropzone.Idle>Dockerイメージをアップロード</Dropzone.Idle>
                            </Text>

                            <Text ta="center" c="dimmed">
                                .tar形式で固められたDockerイメージをドロップすることでアップロードします
                            </Text>
                        </div>
                    </Dropzone>
                    <Stack>
                        <Text
                            size="sm"
                            fw="bold"
                        >
                            選択済みファイル({form.getValues().files.length})
                        </Text>
                        {form.getValues().files.map((file, i) => (
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
                    </Stack>
                    <Space h="lg" />
                    <Checkbox
                        label="manifestの情報を使用する"
                        description="イメージ名とタグをmanifestの情報から自動的に決定します"
                        size="md"
                        radius="md"
                        checked={form.getValues().useManifest || form.getValues().files.length > 1}
                        disabled={form.getValues().files.length > 1}
                        onChange={e=>form.setFieldValue('useManifest', e.currentTarget.checked)}
                    />
                    {!form.getValues().useManifest && (
                        <>
                            <TextInput
                                label="Repository"
                                description="アップロードするDockerイメージのリポジトリ名"
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
                        </>
                    )}

                    <Space h="md" />
                    <Button
                        size="lg"
                        radius="lg"
                        type="submit"
                        loading={loading}
                    >
                        Upload & Push
                    </Button>
                    <Button
                        type="button"
                        size="lg"
                        radius="lg"
                        variant="light"
                        leftSection={<IconRefresh size="1.1rem" />}
                        onClick={handleRetryFailed}
                        disabled={loading || failedCount === 0}
                    >
                        失敗したイメージを再試行
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
