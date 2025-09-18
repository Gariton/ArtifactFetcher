'use client';

import { Group, Space, Tabs, Text, ThemeIcon, Title } from '@mantine/core';
import { IconBrandNpm, IconDownload, IconUpload } from '@tabler/icons-react';
import { DownloadPane } from './download';
import { UploadPane } from './upload';
import { useEffect, useState } from 'react';
import { getEnvironmentVar } from '@/components/actions';

export default function NpmPage() {

    const [env, setEnv] = useState({
        NPM_UPLOAD: "yes",
        NPM_UPLOAD_REGISTORY: "",
        NPM_UPLOAD_AUTH_TOKEN: "",
        NPM_UPLOAD_USERNAME: "",
        NPM_UPLOAD_PASSWORD: "",
    });

    useEffect(() => {
        getEnvironmentVar().then(v => {
            setEnv({
                NPM_UPLOAD: v.NPM_UPLOAD,
                NPM_UPLOAD_REGISTORY: v.NPM_UPLOAD_REGISTORY,
                NPM_UPLOAD_AUTH_TOKEN: v.NPM_UPLOAD_AUTH_TOKEN,
                NPM_UPLOAD_USERNAME: v.NPM_UPLOAD_USERNAME,
                NPM_UPLOAD_PASSWORD: v.NPM_UPLOAD_PASSWORD
            });
        });
    }, [])

    return (
        <div>
            <Group
                justify="space-between"
            >
                <Title>
                    npm package
                </Title>
                <ThemeIcon
                    variant="transparent"
                    size={60}
                >
                    <IconBrandNpm
                        color="red"
                        style={{width: '70%', height: '70%'}}
                        stroke={1.3}
                    />
                </ThemeIcon>
            </Group>
            <Text
                c="dimmed"
            >
                NPM公式リポジトリから指定したパッケージとそれに依存するパッケージをダウンロードし固めたものをダウンロードします
            </Text>

            <Space h="xl" />
            
            <Tabs
                variant="pills"
                radius="lg"
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

                <Tabs.Panel value="download">
                    <DownloadPane />
                </Tabs.Panel>
                {/^(1|true|on|yes)$/i.test(env.NPM_UPLOAD || '') && (
                    <Tabs.Panel value="upload">
                        <UploadPane />
                    </Tabs.Panel>
                )}
            </Tabs>
            <Space h="xl" />
        </div>
    );
}
