'use client';
import { Space, Tabs } from "@mantine/core";
import { IconDownload, IconUpload } from "@tabler/icons-react";
import { DownloadPane } from "./download";
import { UploadPane } from "./upload";
import { getEnvironmentVar } from "@/components/actions";
import { PageHeader } from "@/components/PageHeader";
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
            <PageHeader
                manager="docker"
                description="レジストリからイメージを依存ごと取得し、docker load 可能な tar を生成。push にも対応。"
            />

            <Space h="md" />

            <Tabs
                variant="pills"
                color="docker"
                radius="xl"
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
