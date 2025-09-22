'use client';

import { getEnvironmentVar } from '@/components/actions';
import { DownloadPane } from './download';
import { UploadPane } from './upload';
import { Group, Space, Tabs, Text, ThemeIcon, Title } from '@mantine/core';
import { IconBrandPython, IconDownload, IconUpload } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

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
            <Group justify="space-between">
                <Title>pip package</Title>
                <ThemeIcon variant="transparent" size={60} color="blue">
                    <IconBrandPython style={{ width: '70%', height: '70%' }} stroke={1.3} />
                </ThemeIcon>
            </Group>
            <Text c="dimmed">
                PyPI や社内レジストリから依存関係を含めた pip パッケージをダウンロードし、tar アーカイブとして取得できます。また、任意の Python パッケージレジストリにアップロードできます。
            </Text>

            <Space h="xl" />

            <Tabs variant="pills" radius="lg" defaultValue="download">
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

                <Tabs.Panel value="download">
                    <DownloadPane />
                </Tabs.Panel>
                {uploadEnabled && (
                    <Tabs.Panel value="upload">
                        <UploadPane env={env} />
                    </Tabs.Panel>
                )}
            </Tabs>
            <Space h="xl" />
        </div>
    );
}
