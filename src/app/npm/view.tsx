'use client';

import { PageHeader } from '@/components/PageHeader';
import type { NpmPublicRuntimeConfig } from '@/lib/publicRuntimeConfig';
import { Space, Tabs } from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { DownloadPane } from './download';
import { UploadPane } from './upload';

export function NpmView({ env }: { env: NpmPublicRuntimeConfig }) {
    const uploadEnabled = /^(1|true|on|yes)$/i.test(env.NPM_UPLOAD || '');

    return (
        <div>
            <PageHeader
                manager="npm"
                description="lockfile / name@semver から依存を全解決し、全 tarball を取得。社内レジストリへ publish も対応。"
            />

            <Space h="md" />

            <Tabs variant="pills" color="npm" radius="xl" defaultValue="download">
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
