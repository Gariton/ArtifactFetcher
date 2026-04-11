'use client';

import { DownloadPane } from './download';
import { Group, Space, Text, ThemeIcon, Title } from '@mantine/core';
import { IconBrain } from '@tabler/icons-react';

export default function HuggingFacePage() {
    return (
        <div>
            <Group justify="space-between">
                <Title>Hugging Face model</Title>
                <ThemeIcon variant="transparent" size={60} color="teal">
                    <IconBrain style={{ width: '70%', height: '70%' }} stroke={1.3} />
                </ThemeIcon>
            </Group>
            <Text c="dimmed">
                Hugging Face からモデルをまとめて取得し、Ollama などのローカル推論環境で使える tar アーカイブを生成します。
            </Text>

            <Space h="xl" />
            <DownloadPane />
            <Space h="xl" />
        </div>
    );
}
