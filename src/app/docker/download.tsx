'use client';
import { Alert, Button, Space, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import { DownloadModal } from "@/components/Download/Modal";

type FormType = {
    repo: string;
    tag: string;
    platform: string;
};

export function DownloadPane() {
    const [error, setError] = useState<null | string>(null);
    const [opened, { open, close }] = useDisclosure(false);
    const [submitValues, setSubmitValues] = useState<FormType | null>(null);

    const form = useForm<FormType>({
        mode: "uncontrolled",
        initialValues: {
            repo: "",
            tag: "",
            platform: "linux/amd64",
        },
        validate: {
            repo: (v) => (v == "" ? "リポジトリを指定してください" : null),
            tag: (v) => (v == "" ? "タグを指定してください" : null),
            platform: (v) => (v == "" ? "プラットフォームを指定してください" : null),
        },
    });

    const onSubmit = (values: FormType) => {
        setError(null);
        setSubmitValues(values);
        open();
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
                大きなイメージの場合、ダウンロードまでに時間がかかる可能性があります!
            </Alert>

            <form onSubmit={form.onSubmit(onSubmit)}>
                <Stack>
                    <TextInput
                        label="Repository"
                        description="欲しいDockerイメージ名を入力"
                        size="lg"
                        radius="lg"
                        placeholder="library/redis"
                        key={form.key("repo")}
                        {...form.getInputProps("repo")}
                        disabled={opened}
                    />
                    <TextInput
                        label="Tag"
                        size="lg"
                        radius="lg"
                        placeholder="7.2"
                        key={form.key("tag")}
                        {...form.getInputProps("tag")}
                        disabled={opened}
                    />
                    <TextInput
                        label="Platform"
                        size="lg"
                        radius="lg"
                        placeholder="linux/amd64"
                        key={form.key("platform")}
                        {...form.getInputProps("platform")}
                        disabled={opened}
                    />
                    <Space h="md" />
                    <Button size="lg" radius="lg" type="submit" loading={opened}>
                        Build & Download
                    </Button>
                </Stack>
            </form>

            {error && (
                <Alert color="red" radius="lg" title="エラー" my="lg" variant="light">
                    {error}
                </Alert>
            )}

            {submitValues && (
                <DownloadModal
                    repo={submitValues.repo}
                    tag={submitValues.tag}
                    platform={submitValues.platform}
                    opened={opened}
                    onClose={() => {
                        close();
                        setSubmitValues(null);
                    }}
                    onError={setError}
                />
            )}
        </div>
    );
}
