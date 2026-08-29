/**
 * Fetches /config.json at runtime so the same build artifact works across
 * test / dev / prod — only the S3-hosted config.json differs per environment.
 * The file is served with Cache-Control: no-cache via CloudFront.
 */
import { useEffect, useState } from 'react';

export interface AppConfig {
  apiEndpoint: string;
  cognitoDomain: string;
  cognitoClientId: string;
  cognitoRedirectUri: string;
}

let cached: AppConfig | null = null;

export function useConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(cached);

  useEffect(() => {
    if (cached) return;
    fetch('/config.json')
      .then((r) => r.json())
      .then((data: AppConfig) => {
        cached = data;
        setConfig(data);
      })
      .catch(() => console.error('Failed to load /config.json'));
  }, []);

  return config;
}
