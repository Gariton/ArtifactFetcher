import { readRpmPublicRuntimeConfig } from '@/lib/publicRuntimeConfig';
import { RpmView } from './view';

export const dynamic = 'force-dynamic';

export default function RpmPage() {
    return <RpmView env={readRpmPublicRuntimeConfig()} />;
}
