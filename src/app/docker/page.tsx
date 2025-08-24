'use client';
import { Group, Space, Tabs, Text, ThemeIcon, Title } from "@mantine/core";
import { IconBrandDocker, IconDownload, IconUpload } from "@tabler/icons-react";
import { DownloadPane } from "./download";
import { UploadPane } from "./upload";

export default function Docker() {
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
                        disabled={process.env.DOCKER_UPLOAD==="false"}
                    >
                        アップロード
                    </Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel
                    value="download"
                >
                    <DownloadPane />
                </Tabs.Panel>
                {process.env.DOCKER_UPLOAD==="true" && (
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