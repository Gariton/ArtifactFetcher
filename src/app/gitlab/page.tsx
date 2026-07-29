'use client';

import { PageHeader } from '@/components/PageHeader';
import { Space } from '@mantine/core';
import { DownloadPane } from './download';

export default function GitLabPage() {
    return (
        <div>
            <PageHeader
                manager="gitlab"
                description="ArtifactFetcherのネットワークからGitLab Repository Archive APIへ接続し、リポジトリをZIPで取得。"
            />
            <Space h="md" />
            <DownloadPane />
            <Space h="xl" />
        </div>
    );
}
