import path from 'path'
import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'
import { attachmentsAccess } from '@/lib/access'
import { MAX_ATTACHMENT_BYTES, ATTACHMENT_MIME_TYPES, formatBytes } from '@/lib/attachments'

const staticDir = process.env.LOCAL_PM_UPLOADS_DIR || path.resolve(process.cwd(), 'uploads')

export const Attachments: CollectionConfig = {
  slug: 'attachments',
  admin: {
    useAsTitle: 'filename',
    defaultColumns: ['filename', 'mimeType', 'filesize', 'createdAt'],
    description: 'Files dropped, pasted, or picked inside a comment or a description.',
  },
  access: attachmentsAccess,
  upload: {
    staticDir,
    mimeTypes: ATTACHMENT_MIME_TYPES,
    displayPreview: true,
  },
  hooks: {
    beforeChange: [
      ({ data }) => {
        const size = typeof data?.filesize === 'number' ? data.filesize : 0
        if (size > MAX_ATTACHMENT_BYTES) {
          throw new APIError(
            `That file is ${formatBytes(size)}. The limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`,
            400,
            null,
            true,
          )
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      admin: {
        description: 'What the image shows, for anyone who cannot see it.',
      },
    },
  ],
  timestamps: true,
}
