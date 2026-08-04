'use client';

import { PageHeader } from '@/components/PageHeader';
import { Space } from '@mantine/core';
import { DownloadPane } from './download';

export default function GitLabPage() {
    return (
        <div>
            <PageHeader
                manager="gitlab"
                description="ArtifactFetcherのネットワークからGitLab APIへ接続し、リポジトリZIPまたはリリースファイルを取得。"
            />
            <Space h="md" />
            <DownloadPane />
            <Space h="xl" />
        </div>
    );
}
