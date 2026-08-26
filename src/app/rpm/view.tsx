'use client';

import { PageHeader } from '@/components/PageHeader';
import type { RpmPublicRuntimeConfig } from '@/lib/publicRuntimeConfig';
import { Space, Tabs } from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { DownloadPane } from './download';
import { UploadPane } from './upload';

export function RpmView({ env }: { env: RpmPublicRuntimeConfig }) {
    const uploadEnabled = /^(1|true|on|yes)$/i.test(env.RPM_UPLOAD || '');

    return (
        <div>
            <PageHeader
                manager="rpm"
                description="公式リポジトリ / EPEL から依存込みで収集し、任意の RPM リポジトリへアップロード。"
            />

            <Space h="md" />

            <Tabs variant="pills" color="rpm" radius="xl" defaultValue="download">
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
            <Space h="xl" />
        </div>
    );
}
