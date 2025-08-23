'use client';
import { Accordion, ActionIcon, Alert, Button, Card, Center, Checkbox, Flex, Group, Modal, PasswordInput, RingProgress, ScrollArea, Space, Stack, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure, useMap } from "@mantine/hooks";
import { useRef, useState } from "react";
import { IconCheck, IconCloudCog, IconCloudUpload, IconDownload, IconFileNeutral, IconStackFront, IconX } from "@tabler/icons-react";
import { LayerCard } from "@/components/LayerCard";
import { Layer } from "@/lib/progressBus";
import { ProgressEvent } from "@/lib/progressBus";
import { Dropzone } from "@mantine/dropzone";
import { nanoid } from "nanoid";

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
    const [perFile, setPerFile] = useState<Record<number, { received: number; total?: number; status: string; }>>({});
    const perLayer = useMap<string, Record<number, {received: number; total?: number; status: "process"|"done"|"skipped";}>>();
    const esRef = useRef<EventSource | null>(null);
    
    const reset = () => {
        setJobId(null);
        manifests.clear();
        perLayer.clear();
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
            setPerFile(values.files.map(f => ({
                received: 0,
                total: f.size,
                status: "waiting"
            })));
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
                // upload files
                if (data.type === "item-start" && data.scope == "upload") {
                    setPerFile((prev) => ({
                        ...prev,
                        [data.index]: {
                            ...prev[data.index],
                            received: 0,
                            total: data.total,
                            status: "processing"
                        }
                    }));
                }
                if (data.type === "item-progress" && data.scope == "upload") {
                    setPerFile((prev) => ({
                        ...prev,
                        [data.index]: {
                            ...prev[data.index],
                            received: data.received,
                            status: "processing"
                        }
                    }));
                }
                if (data.type === "item-done" && data.scope == "upload") {
                    setPerFile((prev) => ({
                        ...prev,
                        [data.index]: {
                            ...prev[data.index],
                            received: prev[data.index]?.total ?? 0,
                            status: "done"
                        }
                    }))
                }

                // push progress
                if (data.type === 'repo-tag-resolved') {
                    open();
                    data.items.map(({repository, tag}) => {
                        manifests.set(`${repository}@${tag}`, []);
                        perLayer.set(`${repository}@${tag}`, {});
                    });
                }
                if (data.type === 'manifest-resolved') {
                    if (data.manifestName) {
                        manifests.set(data.manifestName, data.items as Layer[]);
                        perLayer.set(data.manifestName, data.items.map(() => ({
                            received: 0,
                            total: 0,
                            status: "process"
                        })));
                    }
                }
                if (data.type === 'item-start' && data.scope == "push-item") {
                    if (data.manifestName) {
                        const record = perLayer.get(data.manifestName) ?? {};
                        perLayer.set(data.manifestName, {...record, [data.index]: {received: 0, total: data.total, status: "process"}});
                    }
                }
                if (data.type === 'item-progress' && data.scope == "push-item") {
                    if (data.manifestName) {
                        const record = perLayer.get(data.manifestName) ?? {};
                        perLayer.set(data.manifestName, {...record, [data.index]: {received: data.received, total: data.total, status: "process"}});
                    }
                }
                if (data.type === 'item-done' && data.scope == "push-item") {
                    if (data.manifestName) {
                        const record = perLayer.get(data.manifestName) ?? {};
                        perLayer.set(data.manifestName, {...record, [data.index]: {...record[data.index], status: "done"}});
                    }
                }
                if (data.type === 'item-skip' && data.scope == 'push-item') {
                    if (data.manifestName) {
                        const record = perLayer.get(data.manifestName) ?? {};
                        perLayer.set(data.manifestName, {...record, [data.index]: {received: 100, total: 100, status: "skipped"}})
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
                            <Card
                                key={i}
                                withBorder
                                radius="lg"
                                style={{cursor: "pointer"}}
                                p="xs"
                            >
                                <Flex gap="sm" align="center">
                                    <RingProgress
                                        sections={[
                                            {
                                                value: perFile[i]?.status == "done" ? 100 : Math.floor(((perFile[i]?.received ?? 0) / file.size) * 100),
                                                color: "green"
                                            }
                                        ]}
                                        label={
                                            <Center>
                                                {perFile[i]?.status == "done" && (
                                                    <IconCheck
                                                        size="1.3em"
                                                        stroke={3}    
                                                    />
                                                )}
                                                {perFile[i]?.status == "processing" && (
                                                    <Text
                                                        size="xs"
                                                    >
                                                        {Math.floor(((perFile[i]?.received ?? 0) / file.size) * 100)}%
                                                    </Text>
                                                )}  
                                                {(perFile[i]?.status == undefined || perFile[i]?.status == "waiting") && (
                                                    <IconFileNeutral
                                                        size="1.3em"
                                                    />
                                                )}
                                            </Center>
                                        }
                                        size={50}
                                        thickness={3}
                                    />
                                    <div
                                        style={{flex: 1}}
                                    >
                                        <Text size="sm">{file.name}</Text>
                                        <Text size="xs" c="dimmed">{(file.size / 1_000_000).toFixed(2)}MB</Text>
                                    </div>
                                    <ActionIcon
                                        variant="transparent"
                                        c={loading ? "dimmed" : "red"}
                                        onClick={()=>{
                                            form.setFieldValue("files", (prev) => prev.filter(n=>n.name!==file.name));
                                        }}
                                        disabled={loading}
                                    >
                                        <IconX size="1.3em"/>
                                    </ActionIcon>
                                </Flex>
                            </Card>
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
            
            <Modal
                opened={opened}
                onClose={()=>{
                    close();
                    reset();
                }}
                centered
                radius="lg"
                size="lg"
                transitionProps={{transition: "pop"}}
                withCloseButton={false}
                styles={{body: {height: '100%'}}}
            >
                <Flex
                    h="100%"
                    direction="column"
                    gap="sm"
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
                                アップロード進捗
                            </Text>
                        </Group>
                        <Text
                            size="xs"
                        >
                            {jobId}
                        </Text>
                    </Group>

                    <ScrollArea
                        h={600}
                    >
                        <Accordion
                            radius="md"
                        >
                            {Array.from(manifests.entries()).map(([manifestName]) => {
                                const manifestLayers = manifests.get(manifestName);
                                if (!manifestLayers) return;
                                const totalLayers = manifestLayers.length;
                                const myManifest = perLayer.get(manifestName!)
                                const doneLayers = Array.from(Object.values(myManifest!).values().filter(l=>l.status=="done"||l.status=="skipped")).length;
                                const manifestPct = totalLayers > 0 ? Math.floor((doneLayers / totalLayers) * 100) : 0;

                                return (
                                    <Accordion.Item
                                        key={manifestName}
                                        value={manifestName}
                                    >
                                        <Accordion.Control>
                                            <Flex
                                                gap="sm"
                                                align="center"
                                            >
                                                <RingProgress
                                                    sections={[{
                                                        value: manifestPct,
                                                        color: "green"
                                                    }]}
                                                    size={50}
                                                    thickness={5}
                                                    label={manifestPct >= 100 ? (
                                                        <Center>
                                                            <IconCheck
                                                                size="1.3em"
                                                                stroke={3}
                                                            />
                                                        </Center>
                                                    ) : (
                                                        <Text
                                                            size="xs"
                                                            ta="center"
                                                        >
                                                            {manifestPct}%
                                                        </Text>
                                                    )}
                                                />
                                                <div>
                                                <Text>
                                                    {manifestName}
                                                </Text>
                                                <Text
                                                    size="sm"
                                                    c="dimmed"
                                                >
                                                    {manifestLayers.length} Layers
                                                </Text>
                                            </div>
                                            </Flex>
                                        </Accordion.Control>
                                        <Accordion.Panel>
                                            <ScrollArea
                                                h={500}
                                            >
                                                <Stack>
                                                    {manifestLayers.map((layer, j) => {
                                                        const info = (perLayer.get(manifestName) ?? {})[j];
                                                        const pct = info?.total ? Math.floor((info.received / info.total) * 100) : undefined;
                                                        return (
                                                            <LayerCard
                                                                key={j}
                                                                number={j}
                                                                progress={pct || 0}
                                                                sha={layer.digest}
                                                                total={info?.total || 0}
                                                                received={info?.received || 0}
                                                                status={info?.status || "process"}
                                                            />
                                                        )
                                                    })}
                                                </Stack>
                                            </ScrollArea>
                                        </Accordion.Panel>
                                    </Accordion.Item>
                                )
                            })}
                        </Accordion>
                    </ScrollArea>
                    <Button
                        color="dark"
                        radius="md"
                        size="md"
                        fullWidth
                        onClick={close}
                    >
                        とじる
                    </Button>
                </Flex>
            </Modal>
        </div>
    );
}