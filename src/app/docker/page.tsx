'use client';
import { Group, Space, Tabs, Text, ThemeIcon, Title } from "@mantine/core";
import { IconBrandDocker, IconDownload, IconUpload } from "@tabler/icons-react";
import { DownloadPane } from "./download";
import { UploadPane } from "./upload";
import { getEnvironmentVar } from "@/components/actions";
import { useEffect, useState } from "react";

type EnvType = {
    DOCKER_UPLOAD: string;
    DOCKER_UPLOAD_REGISTRY: string;
    DOCKER_UPLOAD_USERNAME: string;
    DOCKER_UPLOAD_PASSWORD: string;
}

export default function Docker() {

    const [env, setEnv] = useState<EnvType>({
        DOCKER_UPLOAD: "yes",
        DOCKER_UPLOAD_REGISTRY: "",
        DOCKER_UPLOAD_USERNAME: "",
        DOCKER_UPLOAD_PASSWORD: "",
    });

    useEffect(() => {
        getEnvironmentVar().then(setEnv);
    }, [])

    return (
        <div>
            <Group
                justify="space-between"
            >
                <Title>
                    Docker Image
                </Title>
                <ThemeIcon
                    variant="transparent"
                    size={60}
                >
                    <IconBrandDocker
                        style={{width: '70%', height: '70%'}}
                        stroke={1.3}
                    />
                </ThemeIcon>
            </Group>
            <Text
                c="dimmed"
            >
                Docker HubのリポジトリからAPIを使用してイメージをダウンロードし、ロードできる形で固めたものをダウンロードします
            </Text>

            <Space h="xl" />

            <Tabs
                variant="pills"
                radius="lg"
                defaultValue="download"
            >
                <Tabs.List>
                    <Tabs.Tab
                        value="download"
                        leftSection={<IconDownload size="1em"/>}
                    >
                        ダウンロード
                    </Tabs.Tab>
                    <Tabs.Tab
                        value="upload"
                        leftSection={<IconUpload size="1em"/>}
                        disabled={!/^(1|true|on|yes)$/i.test(env.DOCKER_UPLOAD || '')}
                    >
                        アップロード
                    </Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel
                    value="download"
                >
                    <DownloadPane />
                </Tabs.Panel>
                {/^(1|true|on|yes)$/i.test(env.DOCKER_UPLOAD || '') && (
                    <Tabs.Panel
                        value="upload"
                    >
                        <UploadPane />
                    </Tabs.Panel>
                )}
            </Tabs>
        </div>
    );
}