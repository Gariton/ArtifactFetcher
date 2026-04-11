'use client';

import { Group, Space, Tabs, Text, ThemeIcon, Title } from '@mantine/core';
import { IconBox, IconDownload, IconUpload } from '@tabler/icons-react';
import { DownloadPane } from './download';
import { UploadPane } from './upload';
import { useEffect, useState } from 'react';
import { getEnvironmentVar } from '@/components/actions';

type RpmEnv = {
    RPM_UPLOAD: string;
    RPM_UPLOAD_REPOSITORY_URL: string;
    RPM_UPLOAD_USERNAME: string;
    RPM_UPLOAD_PASSWORD: string;
    RPM_UPLOAD_TOKEN: string;
    RPM_UPLOAD_METHOD: string;
    RPM_UPLOAD_IGNORE_TLS_VERIFY: string;
};

export default function RpmPage() {
    const [env, setEnv] = useState<RpmEnv>({
        RPM_UPLOAD: 'yes',
        RPM_UPLOAD_REPOSITORY_URL: '',
        RPM_UPLOAD_USERNAME: '',
        RPM_UPLOAD_PASSWORD: '',
        RPM_UPLOAD_TOKEN: '',
        RPM_UPLOAD_METHOD: 'put',
        RPM_UPLOAD_IGNORE_TLS_VERIFY: '',
    });

    useEffect(() => {
        getEnvironmentVar().then((vars: any) => {
            setEnv({
                RPM_UPLOAD: vars.RPM_UPLOAD ?? 'yes',
                RPM_UPLOAD_REPOSITORY_URL: vars.RPM_UPLOAD_REPOSITORY_URL ?? '',
                RPM_UPLOAD_USERNAME: vars.RPM_UPLOAD_USERNAME ?? '',
                RPM_UPLOAD_PASSWORD: vars.RPM_UPLOAD_PASSWORD ?? '',
                RPM_UPLOAD_TOKEN: vars.RPM_UPLOAD_TOKEN ?? '',
                RPM_UPLOAD_METHOD: vars.RPM_UPLOAD_METHOD ?? 'put',
                RPM_UPLOAD_IGNORE_TLS_VERIFY: vars.RPM_UPLOAD_IGNORE_TLS_VERIFY ?? '',
            });
        });
    }, []);

    const uploadEnabled = /^(1|true|on|yes)$/i.test(env.RPM_UPLOAD || '');

    return (
        <div>
            <Group justify="space-between">
                <Title>rpm package</Title>
                <ThemeIcon variant="transparent" size={60} color="yellow">
                    <IconBox style={{ width: '70%', height: '70%' }} stroke={1.3} />
                </ThemeIcon>
            </Group>
            <Text c="dimmed">
                公式リポジトリや EPEL から依存関係を含めた rpm をダウンロードし、任意の RPM リポジトリにアップロードできます。
            </Text>

            <Space h="xl" />

            <Tabs variant="pills" radius="lg" defaultValue="download">
                <Tabs.List>
                    <Tabs.Tab value="download" leftSection={<IconDownload size="1em" />}>ダウンロード</Tabs.Tab>
                    <Tabs.Tab value="upload" leftSection={<IconUpload size="1em" />} disabled={!uploadEnabled}>アップロード</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="download"><DownloadPane /></Tabs.Panel>
                {uploadEnabled && <Tabs.Panel value="upload"><UploadPane env={env} /></Tabs.Panel>}
            </Tabs>
            <Space h="xl" />
        </div>
    );
}
