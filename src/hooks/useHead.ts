import { useEffect } from 'react';
import { APP_NAME, SITE_URL } from '../config';

interface UseHeadOptions {
  title: string;
  description: string;
  path?: string;
  robots?: string;
  jsonLd?: Record<string, unknown>;
}

function setMeta(attr: 'name' | 'property', key: string, content: string): void {
  let element = document.querySelector(`meta[${attr}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attr, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

export function useHead({ title, description, path = '/', robots, jsonLd }: UseHeadOptions): void {
  useEffect(() => {
    document.title = title;
    const canonicalUrl = `${SITE_URL}${path === '/' ? '/' : path}`;

    setMeta('name', 'description', description);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', canonicalUrl);
    setMeta('property', 'og:site_name', APP_NAME);
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', description);

    if (robots) {
      setMeta('name', 'robots', robots);
    } else {
      const existingRobots = document.querySelector('meta[name="robots"]');
      if (existingRobots) {
        existingRobots.setAttribute('content', 'index, follow');
      }
    }

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;
  }, [title, description, path, robots]);

  useEffect(() => {
    if (!jsonLd) return;
    const scriptId = 'cutout-jsonld';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.type = 'application/ld+json';
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(jsonLd);

    return () => {
      script?.remove();
    };
  }, [jsonLd]);
}
