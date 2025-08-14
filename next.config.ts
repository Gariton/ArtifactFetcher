import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // これで RSC/SSR のサーババンドルから丸ごと外出し
    serverComponentsExternalPackages: [
      '@npmcli/arborist',
      'pacote',
      'npm-package-arg',
      'ssri',
      'minipass', // pacote系がよく使う
    ],
  },
  webpack(config, { isServer }) {
    if (isServer) {
      // externals は array とは限らないため安全に配列化してから push
      const current = (config as any).externals ?? [];
      (config as any).externals = Array.isArray(current) ? current : [current];
      (config as any).externals.push({
        'node-gyp': 'commonjs node-gyp',
        'node-gyp-build': 'commonjs node-gyp-build',
      });
    }

    // C# ファイルをモジュールとして扱わない（アセット扱い）
    const rules = (config.module as any).rules ?? [];
    (config.module as any).rules = Array.isArray(rules) ? rules : [rules];
    (config.module as any).rules.push({
      test: /\.cs$/i,
      type: 'asset/source',
    });

    return config;
  },
};

export default nextConfig;