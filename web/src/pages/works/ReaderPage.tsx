import { useReaderController } from './readerController';
import { ReaderView } from './ReaderView';
import './reader-images.css';

/** Keep the public route stable while the reader owns its state and rendering separately. */
export default function ReaderPage() {
  const reader = useReaderController();
  return <ReaderView reader={reader} />;
}
