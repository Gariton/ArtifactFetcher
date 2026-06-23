'use client';

import { Space, Tabs } from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { DownloadPane } from './download';
import { UploadPane } from './upload';
import { useEffect, useState } from 'react';
import { getEnvironmentVar } from '@/components/actions';
import { PageHeader } from '@/components/PageHeader';

export default function NpmPage() {

    const [env, setEnv] = useState({
        NPM_UPLOAD: "yes",
        NPM_UPLOAD_REGISTRY: "",
        NPM_UPLOAD_AUTH_TOKEN: "",
        NPM_UPLOAD_USERNAME: "",
        NPM_UPLOAD_PASSWORD: "",
    });

    useEffect(() => {
        getEnvironmentVar().then(v => {
            setEnv({
                NPM_UPLOAD: v.NPM_UPLOAD,
                NPM_UPLOAD_REGISTRY: v.NPM_UPLOAD_REGISTRY,
                NPM_UPLOAD_AUTH_TOKEN: v.NPM_UPLOAD_AUTH_TOKEN,
                NPM_UPLOAD_USERNAME: v.NPM_UPLOAD_USERNAME,
                NPM_UPLOAD_PASSWORD: v.NPM_UPLOAD_PASSWORD
            });
        });
    }, [])

    return (
        <div>
            <PageHeader
                manager="npm"
                description="lockfile / name@semver から依存を全解決し、全 tarball を取得。社内レジストリへ publish も対応。"
            />

            <Space h="md" />

            <Tabs
                variant="pills"
                color="npm"
                radius="xl"
                defaultValue="download"
            >
                <Tabs.List>
                    <Tabs.Tab
                        value="download"
                        leftSection={<IconDownload size="1em" />}
                    >
                        ダウンロード
                    </Tabs.Tab>
                    <Tabs.Tab
                        value="upload"
                        leftSection={<IconUpload size="1em" />}
                        disabled={!/^(1|true|on|yes)$/i.test(env.NPM_UPLOAD || '')}

                    >
                        アップロード
                    </Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="download" py="lg">
                    <DownloadPane />
                </Tabs.Panel>
                {/^(1|true|on|yes)$/i.test(env.NPM_UPLOAD || '') && (
                    <Tabs.Panel value="upload" py="lg">
                        <UploadPane />
                    </Tabs.Panel>
                )}
            </Tabs>
            <Space h="xl" />
        </div>
    );
}
