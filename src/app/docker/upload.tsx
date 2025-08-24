'use client';
import { Accordion, Alert, Button, Checkbox, Group, PasswordInput, Space, Stack, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure, useMap } from "@mantine/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconCloudCog, IconCloudUpload, IconDownload, IconX } from "@tabler/icons-react";
import { Layer } from "@/lib/progressBus";
import { ProgressEvent } from "@/lib/progressBus";
import { Dropzone } from "@mantine/dropzone";
import { nanoid } from "nanoid";
import { FileItem } from "@/components/Upload/FileItem";
import { UploadModal } from "@/components/Upload/Modal";

type FormType = {
    files: File[];
    useManifest: boolean;
    registry: string;
    repo: string;
    tag: string;
    username: string;
    password: string;
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
    const scheduleFlush = useCallback(() => {
        if (flushTimerRef.current) return;
        flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            setPerFileSnap({...perFileRef.current})
            setPerLayerSnap(new Map(perLayerRef.current.entries()));
        }, FLUSH_INTERVAL);
    }, []);

    const esRef = useRef<EventSource | null>(null);
    
    const reset = () => {
        setJobId(null);
        manifests.clear();
        perLayerRef.current = new Map();
        setPerLayerSnap(new Map());
        esRef.current?.close();
        esRef.current = null;
    }
    const form = useForm<FormType>({
        mode: "uncontrolled",
        initialValues: {
            files: [],
            useManifest: true,
            registry: process.env.DOCKER_UPLOAD_REGISTORY || '',
            repo: "",
            tag: "",
            username: process.env.DOCKER_UPLOAD_USERNAME || '',
            password: process.env.DOCKER_UPLOAD_PASSWORD || ''
        },
        validate: {
            registry: (v) => v=="" ? "レジストリを指定してください" : null,
            repo: (v, x) => v==""&&!x.useManifest ? "リポジトリを指定してください" : null,
            tag: (v, x) => v==""&&!x.useManifest ? "タグを指定してください" : null,
        }
    })
    
    const onSubmit = async (values: typeof form.values) => {
        setLoading(true);
        setError(null);
        reset();
        try {
            if (values.files.length <= 0) {setError("Dockerイメージファイルを選択してください"); return;}
            perFileRef.current = values.files.map(f => ({
                received: 0,
                total: f.size,
                status: "waiting"
            }));
            // フロントからSSEを張ってアップロード状況も関ししたい
            const jobId = nanoid();
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
                scheduleFlush();
                // upload files
                if (data.type === "item-start" && data.scope == "upload") {
                    perFileRef.current = {
                        ...perFileRef.current,
                        [data.index]: {
                            ...perFileRef.current[data.index],
                            received: 0,
                            total: data.total,
                            status: "processing"
                        }
                    }
                }
                if (data.type === "item-progress" && data.scope == "upload") {
                    perFileRef.current = {
                        ...perFileRef.current,
                        [data.index]: {
                             ...perFileRef.current[data.index],
                            received: data.received,
                            status: "processing"
                        }
                    }
                }
                if (data.type === "item-done" && data.scope == "upload") {
                    perFileRef.current = {
                        ...perFileRef.current,
                        [data.index]: {
                            ...perFileRef.current[data.index],
                            received: perFileRef.current[data.index]?.total ?? 0,
                            status: "done"
                        }
                    }
                }

                // push progress
                if (data.type === 'repo-tag-resolved') {
                    open();
                    data.items.map(({repository, tag}) => {
                        manifests.set(`${repository}@${tag}`, []);
                        perLayerRef.current.set(`${repository}@${tag}`, {});
                    });
                }
                if (data.type === 'manifest-resolved') {
                    if (data.manifestName) {
                        manifests.set(data.manifestName, data.items as Layer[]);
                        perLayerRef.current.set(data.manifestName, data.items.map(() => ({
                            received: 0,
                            total: 0,
                            status: "process"
                        })));
                    }
                }
                if (data.type === 'item-start' && data.scope == "push-item") {
                    if (data.manifestName) {
                        const record = perLayerRef.current.get(data.manifestName) ?? {};
                        perLayerRef.current.set(data.manifestName, {...record, [data.index]: {received: 0, total: data.total, status: "process"}});
                    }
                }
                if (data.type === 'item-progress' && data.scope == "push-item") {
                    if (data.manifestName) {
                        const record = perLayerRef.current.get(data.manifestName) ?? {};
                        perLayerRef.current.set(data.manifestName, {...record, [data.index]: {received: data.received, total: data.total, status: "process"}});
                    }
                }
                if (data.type === 'item-done' && data.scope == "push-item") {
                    if (data.manifestName) {
                        const record = perLayerRef.current.get(data.manifestName) ?? {};
                        perLayerRef.current.set(data.manifestName, {...record, [data.index]: {...record[data.index], status: "done"}});
                    }
                }
                if (data.type === 'item-skip' && data.scope == 'push-item') {
                    if (data.manifestName) {
                        const record = perLayerRef.current.get(data.manifestName) ?? {};
                        perLayerRef.current.set(data.manifestName, {...record, [data.index]: {received: 100, total: 100, status: "skipped"}})
                    }
                }
                // if (data.type === 'stage') setStatus(data.stage);
                if (data.type === 'error') {
                    es.close();
                    setLoading(false);
                }
                if (data.type === 'done') {
                    es.close();
                    setLoading(false);
                }
            }

            const fd = new FormData();
            for (const f of Array.from(values.files)) fd.append('files', f, f.name);

            const qs = new URLSearchParams({
                jobId,
                registry: values.registry,
                repository: values.repo,
                insecureTLS: "true",
                concurrency: "1",
                ...(values.username ? { username: values.username } : {}),
                ...(values.password ? { password: values.password } : {}),
                tag: values.tag,
                useManifest: String(values.useManifest)
            });

            const res = await fetch(`/api/docker/upload-multi?${qs.toString()}`, {
                method: 'POST',
                body: fd 
            });

            if (!res.ok) {
                alert('push start failed');
                return;
            }
        } catch (e: any) {
            setError(e.message || "アップロードに失敗しました")
        }
    };

    useEffect(() => {
        return () => {
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            esRef.current?.close();
        };
    }, []);

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
                onSubmit={form.onSubmit(onSubmit)}
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
                        onDrop={(v)=>form.setFieldValue('files', v)}
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
                                onDelete={()=>form.setFieldValue("files", (prev) => prev.filter(n=>n.name!==file.name))}
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