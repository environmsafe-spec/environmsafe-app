#!/usr/bin/env python3
"""Build the WhatsApp / Meta catalog feed from docs/whatsapp/items.json.

Writes the same CSV to two places:
  docs/whatsapp/catalog.csv      - for a one-off upload in Commerce Manager
  public/whatsapp-catalog.csv    - served at https://www.environmsafe.com/whatsapp-catalog.csv
                                   for a scheduled feed, so Meta picks up changes daily

Meta requires a price on every item, so each is listed at 1 USD with a note
asking the customer to request a quote. Images are rendered separately by
scripts/render_catalog_images.js.
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://www.environmsafe.com'

NOTE_AR = 'السعر المعروض (1 دولار) رمزي فقط — تواصلوا معنا عبر واتساب أو على support@environmsafe.com لطلب عرض سعر.'
NOTE_EN = 'The listed price (1 USD) is a placeholder only — message us on WhatsApp or email support@environmsafe.com to request a quote.'
TITLE_SUFFIX = ' – السعر حسب الطلب'

FIELDS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link',
          'image_link', 'brand', 'product_type', 'custom_label_0']


def image_name(item):
    return item.get('image') or item['code'].lower()


def row(item, service):
    return {
        'id': item['code'],
        'title': item['name_ar'] + TITLE_SUFFIX,
        'description': ' '.join([NOTE_AR, item['desc_ar'], item['desc_en'], NOTE_EN]),
        'availability': 'in stock',
        'condition': 'new',
        'price': '1.00 USD',
        'link': service['link'],
        'image_link': f"{SITE}/img/catalog/{image_name(item)}.png",
        'brand': 'EnvironmSafe',
        # product_type and custom_label_0 let Commerce Manager build one set per service.
        'product_type': service['name_en'],
        'custom_label_0': service['name_ar'],
    }


def main():
    data = json.loads((ROOT / 'docs/whatsapp/items.json').read_text(encoding='utf-8'))
    rows = []
    for service in data['services']:
        rows.append(row(service, service))
        rows.extend(row(item, service) for item in service['items'])

    for path in (ROOT / 'docs/whatsapp/catalog.csv', ROOT / 'public/whatsapp-catalog.csv'):
        with path.open('w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(rows)
    print(f'{len(rows)} items')


if __name__ == '__main__':
    main()
