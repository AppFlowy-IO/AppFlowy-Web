import axios from 'axios';
import React, { useEffect } from 'react';

function MentionExternalLink ({
  url,
}: {
  url: string;
}) {
  const [data, setData] = React.useState<{ title?: string; logo?: string } | undefined>(undefined);

  useEffect(() => {
    void axios.get(`https://api.microlink.io/?url=${url}`).then((data) => {
        setData({
          title: data.data.data.title,
          logo: data.data.data.logo.url,
        });
      },
    );
  }, [url]);
  return (
    <span
      onClick={() => {
        window.open(url, '_blank');
      }}
      className={'cursor-pointer inline-flex gap-1.5 text-text-primary hover:underline'}
    >
      {data?.logo && (
        <span className={'mt-0.5'}>
          <img
            className={'object-cover w-5 h-5'}
            src={data.logo}
            alt={data.logo}
          />
        </span>
      )}
      <span className={'leading-[24px]'}>{data?.title || url}</span>
    </span>
  );
}

export default MentionExternalLink;