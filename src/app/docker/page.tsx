import { readDockerPublicRuntimeConfig } from '@/lib/publicRuntimeConfig';
import { DockerView } from './view';

export const dynamic = 'force-dynamic';

export default function DockerPage() {
    return <DockerView env={readDockerPublicRuntimeConfig()} />;
}
