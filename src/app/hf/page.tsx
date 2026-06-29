'use client';

import { DownloadPane } from './download';
import { Space } from '@mantine/core';
import { PageHeader } from '@/components/PageHeader';

export default function HuggingFacePage() {
    return (
        <div>
            <PageHeader
                manager="hf"
                description="GGUF 等の必要ファイルだけ選択取得し、Ollama などローカル推論で使える tar アーカイブを生成。"
            />

            <Space h="md" />
            <DownloadPane />
            <Space h="xl" />
        </div>
    );
}
