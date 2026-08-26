'use client';

import { PageHeader } from '@/components/PageHeader';
import type { PipPublicRuntimeConfig } from '@/lib/publicRuntimeConfig';
import { Space, Tabs } from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { DownloadPane } from './download';
import { UploadPane } from './upload';

export function PipView({ env }: { env: PipPublicRuntimeConfig }) {
    const uploadEnabled = /^(1|true|on|yes)$/i.test(env.PIP_UPLOAD || '');

    return (
        <div>
            <PageHeader
                manager="pip"
                description="PyPI / 社内インデックスから依存込みでまとめて取得し、tar アーカイブ化。任意のレジストリへアップロードも可能。"
            />

            <Space h="md" />

            <Tabs variant="pills" color="pip" radius="xl" defaultValue="download">
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
