'use client';

import { Space, Tabs } from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { DownloadPane } from './download';
import { UploadPane } from './upload';
import { useEffect, useState } from 'react';
import { getEnvironmentVar } from '@/components/actions';
import { PageHeader } from '@/components/PageHeader';

type RpmEnv = {
    RPM_UPLOAD: string;
    RPM_UPLOAD_REPOSITORY_URL: string;
    RPM_UPLOAD_METHOD: string;
    RPM_UPLOAD_IGNORE_TLS_VERIFY: string;
};

export default function RpmPage() {
    const [env, setEnv] = useState<RpmEnv>({
        RPM_UPLOAD: 'false',
        RPM_UPLOAD_REPOSITORY_URL: '',
        RPM_UPLOAD_METHOD: 'put',
        RPM_UPLOAD_IGNORE_TLS_VERIFY: '',
    });

    useEffect(() => {
        getEnvironmentVar().then((vars: any) => {
            setEnv({
                RPM_UPLOAD: vars.RPM_UPLOAD ?? 'false',
                RPM_UPLOAD_REPOSITORY_URL: vars.RPM_UPLOAD_REPOSITORY_URL ?? '',
                RPM_UPLOAD_METHOD: vars.RPM_UPLOAD_METHOD ?? 'put',
                RPM_UPLOAD_IGNORE_TLS_VERIFY: vars.RPM_UPLOAD_IGNORE_TLS_VERIFY ?? '',
            });
        });
    }, []);

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
                    <Tabs.Tab value="download" leftSection={<IconDownload size="1em" />}>ダウンロード</Tabs.Tab>
                    <Tabs.Tab value="upload" leftSection={<IconUpload size="1em" />} disabled={!uploadEnabled}>アップロード</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="download" py="lg"><DownloadPane /></Tabs.Panel>
                {uploadEnabled && <Tabs.Panel value="upload" py="lg"><UploadPane env={env} /></Tabs.Panel>}
            </Tabs>
            <Space h="xl" />
        </div>
    );
}
