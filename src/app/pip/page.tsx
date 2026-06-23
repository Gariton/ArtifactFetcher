'use client';

import { getEnvironmentVar } from '@/components/actions';
import { DownloadPane } from './download';
import { UploadPane } from './upload';
import { Space, Tabs } from '@mantine/core';
import { IconDownload, IconUpload } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';

type PipEnv = {
    PIP_UPLOAD: string;
    PIP_UPLOAD_REGISTRY: string;
    PIP_UPLOAD_USERNAME: string;
    PIP_UPLOAD_PASSWORD: string;
    PIP_UPLOAD_TOKEN: string;
    PIP_UPLOAD_SKIP_EXISTING: string;
};

export default function PipPage() {
    const [env, setEnv] = useState<PipEnv>({
        PIP_UPLOAD: 'yes',
        PIP_UPLOAD_REGISTRY: '',
        PIP_UPLOAD_USERNAME: '',
        PIP_UPLOAD_PASSWORD: '',
        PIP_UPLOAD_TOKEN: '',
        PIP_UPLOAD_SKIP_EXISTING: 'false',
    });

    useEffect(() => {
        getEnvironmentVar().then((vars: any) => {
            setEnv({
                PIP_UPLOAD: vars.PIP_UPLOAD ?? 'yes',
                PIP_UPLOAD_REGISTRY: vars.PIP_UPLOAD_REGISTRY ?? '',
                PIP_UPLOAD_USERNAME: vars.PIP_UPLOAD_USERNAME ?? '',
                PIP_UPLOAD_PASSWORD: vars.PIP_UPLOAD_PASSWORD ?? '',
                PIP_UPLOAD_TOKEN: vars.PIP_UPLOAD_TOKEN ?? '',
                PIP_UPLOAD_SKIP_EXISTING: vars.PIP_UPLOAD_SKIP_EXISTING ?? 'false',
            });
        });
    }, []);

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
                    <Tabs.Tab
                        value="upload"
                        leftSection={<IconUpload size="1em" />}
                        disabled={!uploadEnabled}
                    >
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
