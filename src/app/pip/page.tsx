import { readPipPublicRuntimeConfig } from '@/lib/publicRuntimeConfig';
import { PipView } from './view';

export const dynamic = 'force-dynamic';

export default function PipPage() {
    return <PipView env={readPipPublicRuntimeConfig()} />;
}
