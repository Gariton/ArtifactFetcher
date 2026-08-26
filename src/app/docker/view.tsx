'use client';

import { PageHeader } from '@/components/PageHeader';
import type { DockerPublicRuntimeConfig } from '@/lib/publicRuntimeConfig';
import { Space, Tabs } from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { DownloadPane } from './download';
import { UploadPane } from './upload';

export function DockerView({ env }: { env: DockerPublicRuntimeConfig }) {
    const uploadEnabled = /^(1|true|on|yes)$/i.test(env.DOCKER_UPLOAD || '');

    return (
        <div>
            <PageHeader
                manager="docker"
                description="レジストリからイメージを依存ごと取得し、docker load 可能な tar を生成。push にも対応。"
            />

            <Space h="md" />

            <Tabs variant="pills" color="docker" radius="xl" defaultValue="download">
                <Tabs.List>
                    <Tabs.Tab value="download" leftSection={<IconDownload size="1em" />}>
                        ダウンロード
                    </Tabs.Tab>
                    <Tabs.Tab value="upload" leftSection={<IconUpload size="1em" />} disabled={!uploadEnabled}>
                        アップロード
                    </Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="download" py="lg">
                    <DownloadPane />
                </Tabs.Panel>
                {uploadEnabled && (
                    <Tabs.Panel value="upload" py="lg">
                        <UploadPane env={env} />
                    </Tabs.Panel>
                )}
            </Tabs>
        </div>
    );
}
