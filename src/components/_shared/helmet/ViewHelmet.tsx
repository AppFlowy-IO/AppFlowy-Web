import { useEffect } from 'react';
import { Helmet } from 'react-helmet';

import { ViewIcon, ViewIconType } from '@/application/types';
import { getIconBase64 } from '@/utils/emoji';

function ViewHelmet({ name, icon }: { name?: string; icon?: ViewIcon }) {
  useEffect(() => {
    const setFavicon = async () => {
      try {
        let url = '/appflowy.svg';
        const link = (document.querySelector("link[rel*='icon']") as HTMLLinkElement) || document.createElement('link');

        if (icon && icon.value) {
          if (icon.ty === ViewIconType.Emoji) {
            const emojiCode = icon?.value?.codePointAt(0)?.toString(16); // Convert emoji to hex code
            const baseUrl = 'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/svg/emoji_u';

            const response = await fetch(`${baseUrl}${emojiCode}.svg`);
            const svgText = await response.text();
            const blob = new Blob([svgText], { type: 'image/svg+xml' });

            url = URL.createObjectURL(blob);

            link.type = 'image/svg+xml';
          } else if (icon.ty === ViewIconType.Icon) {
            const { groupName, iconName, color } = JSON.parse(icon.value);
            const id = `${groupName}/${iconName}`;

            url = (await getIconBase64(id, color)) || '';
            link.type = 'image/svg+xml';
          }
        }

        link.rel = 'icon';
        link.href = url;
        document.getElementsByTagName('head')[0].appendChild(link);
      } catch (error) {
        console.error('Error setting favicon:', error);
      }
    };

    void setFavicon();

    return () => {
      const link = document.querySelector("link[rel*='icon']");

      if (link) {
        document.getElementsByTagName('head')[0].removeChild(link);
      }
    };
  }, [icon]);

  const url = window.location.href;

  useEffect(() => {
    const setCanonical = () => {
      let link = document.querySelector("link[rel*='canonical']") as HTMLLinkElement;

      if (link) {
        document.getElementsByTagName('head')[0].removeChild(link);
      }

      let ogLink = document.querySelector("link[rel*='og:url']") as HTMLLinkElement;

      if (ogLink) {
        document.getElementsByTagName('head')[0].removeChild(ogLink);
      }

      link = document.createElement('link');

      link.rel = 'canonical';
      link.href = url;
      document.getElementsByTagName('head')[0].appendChild(link);

      ogLink = document.createElement('link');
      ogLink.rel = 'og:url';
      ogLink.href = url;
      document.getElementsByTagName('head')[0].appendChild(ogLink);
    };

    setCanonical();
  }, [url]);

  if (!name) return null;
  return (
    <Helmet>
      <title>{name} | CustomerIK</title>
    </Helmet>
  );
}

export default ViewHelmet;
