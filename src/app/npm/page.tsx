import { readNpmPublicRuntimeConfig } from '@/lib/publicRuntimeConfig';
import { NpmView } from './view';

export const dynamic = 'force-dynamic';

export default function NpmPage() {
    return <NpmView env={readNpmPublicRuntimeConfig()} />;
}
