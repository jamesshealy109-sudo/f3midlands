export interface AoPhoto {
  src: string;
  alt: string;
  caption: string;
}

export interface AoMedia {
  hero: AoPhoto;
  heading: string;
  description: string;
  gallery: AoPhoto[];
}

const AO_MEDIA_BY_NAME: Record<string, AoMedia> = {
  detention: {
    hero: {
      src: '/assets/aos/detention/detention-pax.jpg',
      alt: 'Detention AO PAX gathered after a morning workout',
      caption: 'The men of Detention after a morning post',
    },
    heading: 'More than morning detention.',
    description:
      'From weekday posts to relay miles, Detention is built around men showing up for one another. The shovel flag marks the spot; the relationships are what keep the AO moving.',
    gallery: [
      {
        src: '/assets/aos/detention/detention-dam-to-dam.jpg',
        alt: 'Detention PAX at the 2025 Dam to Dam 100K Relay beside Lake Greenwood',
        caption: 'Detention PAX • Dam to Dam 100K Relay • 2025',
      },
      {
        src: '/assets/aos/detention/detention-shovel-flag.jpg',
        alt: 'The Detention AO shovel flag planted in the early morning gloom',
        caption: 'Plant the flag. Honor the men. Keep showing up.',
      },
    ],
  },
};

export function getAoMedia(aoName: string) {
  return AO_MEDIA_BY_NAME[aoName.trim().toLowerCase()];
}
