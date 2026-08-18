import { PageHeader } from '@/components/PageHeader';
import { readGitLabPublicConfig } from '@/lib/gitlab/config';
import { Space } from '@mantine/core';
import { DownloadPane } from './download';

// GITLAB_BASE_URL is a runtime setting. Do not pre-render this page with the
// environment that happened to be present while the Docker image was built.
export const dynamic = 'force-dynamic';

export default function GitLabPage() {
    const { baseUrl, tokenConfigured } = readGitLabPublicConfig();

    return (
        <div>
            <PageHeader
                manager="gitlab"
                description="ArtifactFetcherのネットワークからGitLab APIへ接続し、リポジトリZIPまたはリリースアセットを取得。"
            />
            <Space h="md" />
            <DownloadPane baseUrl={baseUrl} configuredToken={tokenConfigured} />
            <Space h="xl" />
        </div>
    );
}
