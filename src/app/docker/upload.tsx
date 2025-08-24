'use client';
import { Accordion, ActionIcon, Alert, Button, Card, Checkbox, Flex, Group, PasswordInput, Space, Stack, Text, TextInput } from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import { IconCloudCog, IconCloudUpload, IconDownload, IconFileNeutral, IconX } from "@tabler/icons-react";
import { UploadModal } from "@/components/Upload/Modal";

type FormType = {
    files: File[];
    useManifest: boolean;
    registry: string;
    repo: string;
    tag: string;
    username: string;
    password: string;
};

export function UploadPane() {
    const [error, setError] = useState<null | string>(null);
    const [opened, { open, close }] = useDisclosure(false);
    const [submitValues, setSubmitValues] = useState<FormType | null>(null);

    const form = useForm<FormType>({
        mode: "uncontrolled",
        initialValues: {
            files: [],
            useManifest: true,
            registry: process.env.DOCKER_UPLOAD_REGISTORY || "",
            repo: "",
            tag: "",
            username: process.env.DOCKER_UPLOAD_USERNAME || "",
            password: process.env.DOCKER_UPLOAD_PASSWORD || "",
        },
        validate: {
            registry: (v) => (v == "" ? "レジストリを指定してください" : null),
            repo: (v, x) => (v == "" && !x.useManifest ? "リポジトリを指定してください" : null),
            tag: (v, x) => (v == "" && !x.useManifest ? "タグを指定してください" : null),
        },
    });

    const onSubmit = (values: FormType) => {
        setError(null);
        if (values.files.length <= 0) {
            setError("Dockerイメージファイルを選択してください");
            return;
        }
        setSubmitValues(values);
        open();
    };

    const disabled = opened;

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

            <form onSubmit={form.onSubmit(onSubmit)}>
                <Stack>
                    <Accordion variant="separated" radius="lg">
                        <Accordion.Item value="upload_settings" key="upload_settings">
                            <Accordion.Control icon={<IconCloudCog size="1em" />}>アップロード先設定</Accordion.Control>
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
                                        disabled={disabled}
                                    />
                                    <TextInput
                                        label="Username"
                                        size="lg"
                                        radius="lg"
                                        placeholder="username"
                                        key={form.key("username")}
                                        {...form.getInputProps("username")}
                                        disabled={disabled}
                                    />
                                    <PasswordInput
                                        label="Password"
                                        size="lg"
                                        radius="lg"
                                        placeholder="password"
                                        key={form.key("password")}
                                        {...form.getInputProps("password")}
                                        disabled={disabled}
                                    />
                                </Stack>
                            </Accordion.Panel>
                        </Accordion.Item>
                    </Accordion>
                    <Dropzone
                        onDrop={(v) => form.setFieldValue("files", v)}
                        radius="lg"
                        accept={["application/x-tar"]}
                        p="xl"
                    >
                        <div style={{ pointerEvents: "none" }}>
                            <Group justify="center">
                                <Dropzone.Accept>
                                    <IconDownload size={50} color={"blue.6"} stroke={1.5} />
                                </Dropzone.Accept>
                                <Dropzone.Reject>
                                    <IconX size={50} color={"red.6"} stroke={1.5} />
                                </Dropzone.Reject>
                                <Dropzone.Idle>
                                    <IconCloudUpload size={50} stroke={1.5} />
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
                        <Text size="sm" fw="bold">
                            選択済みファイル({form.getValues().files.length})
                        </Text>
                        {form.getValues().files.map((file, i) => (
                            <Card
                                key={i}
                                withBorder
                                radius="lg"
                                style={{ cursor: "pointer" }}
                                p="xs"
                            >
                                <Flex gap="sm" align="center">
                                    <IconFileNeutral size="1.3em" />
                                    <div style={{ flex: 1 }}>
                                        <Text size="sm">{file.name}</Text>
                                        <Text size="xs" c="dimmed">
                                            {(file.size / 1_000_000).toFixed(2)}MB
                                        </Text>
                                    </div>
                                    <ActionIcon
                                        variant="transparent"
                                        c={disabled ? "dimmed" : "red"}
                                        onClick={() => {
                                            form.setFieldValue("files", (prev) => prev.filter((n) => n.name !== file.name));
                                        }}
                                        disabled={disabled}
                                    >
                                        <IconX size="1.3em" />
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
                        disabled={disabled || form.getValues().files.length > 1}
                        onChange={(e) => form.setFieldValue("useManifest", e.currentTarget.checked)}
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
                                disabled={disabled}
                            />
                            <TextInput
                                label="Tag"
                                size="lg"
                                radius="lg"
                                placeholder="7.2"
                                key={form.key("tag")}
                                {...form.getInputProps("tag")}
                                disabled={disabled}
                            />
                        </>
                    )}

                    <Space h="md" />
                    <Button size="lg" radius="lg" type="submit" loading={opened}>
                        Upload & Push
                    </Button>
                </Stack>
            </form>

            {error && (
                <Alert color="red" radius="lg" title="エラー" my="lg" variant="light">
                    {error}
                </Alert>
            )}

            {submitValues && (
                <UploadModal
                    opened={opened}
                    onClose={() => {
                        close();
                        setSubmitValues(null);
                    }}
                    files={submitValues.files}
                    options={{
                        registry: submitValues.registry,
                        repo: submitValues.repo,
                        tag: submitValues.tag,
                        username: submitValues.username,
                        password: submitValues.password,
                        useManifest: submitValues.useManifest,
                    }}
                    onError={setError}
                />
            )}
        </div>
    );
}
