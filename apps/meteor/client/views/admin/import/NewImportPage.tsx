import {
	Box,
	Button,
	ButtonGroup,
	Callout,
	Chip,
	Field,
	Margins,
	Select,
	InputBox,
	TextInput,
	Throbber,
	UrlInput,
} from '@rocket.chat/fuselage';
import { useUniqueId, useSafely } from '@rocket.chat/fuselage-hooks';
import type { To, TranslationKey } from '@rocket.chat/ui-contexts';
import { useToastMessageDispatch, useRouter, useRouteParameter, useSetting, useEndpoint, useTranslation } from '@rocket.chat/ui-contexts';
import React, { useState, useMemo, useEffect } from 'react';
import type { DragEvent, SyntheticEvent, ChangeEventHandler, ChangeEvent } from 'react';

import { Importers } from '../../../../app/importer/client/index';
import Page from '../../../components/Page';
import { useFormatMemorySize } from '../../../hooks/useFormatMemorySize';
import { useErrorHandler } from './useErrorHandler';

function NewImportPage() {
	const t = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const handleError = useErrorHandler();

	const [isLoading, setLoading] = useSafely(useState(false));
	const [fileType, setFileType] = useSafely(useState('upload'));
	const importerKey = useRouteParameter('importerKey') as string;
	const importer = useMemo(() => Importers.get(importerKey), [importerKey]);

	const maxFileSize = useSetting('FileUpload_MaxFileSize');

	const router = useRouter();

	const uploadImportFile = useEndpoint('POST', '/v1/uploadImportFile');
	const downloadPublicImportFile = useEndpoint('POST', '/v1/downloadPublicImportFile');

	useEffect(() => {
		if (importerKey && !importer) {
			router.navigate('/admin/import/new', { replace: true });
		}
	}, [importer, importerKey, router]);

	const formatMemorySize = useFormatMemorySize();

	const handleBackToImportsButtonClick = () => {
		router.navigate('/admin/import');
	};

	const handleImporterKeyChange = (importerKey: string) => {
		router.navigate(
			router.buildRoutePath({
				pattern: '/admin/import/new/:importerKey?',
				params: { importerKey },
			}) as To,
			{ replace: true },
		);
	};

	const handleFileTypeChange = (fileType: string) => {
		setFileType(fileType);
	};

	const [files, setFiles] = useState<File[]>([]);

	const isDataTransferEvent = <T extends SyntheticEvent>(event: T): event is T & DragEvent<HTMLInputElement> =>
		Boolean('dataTransfer' in event && (event as any).dataTransfer.files);

	const handleImportFileChange: ChangeEventHandler<HTMLInputElement> = async (event) => {
		let { files } = event.target;

		if (!files || files.length === 0) {
			if (isDataTransferEvent(event)) {
				files = event.dataTransfer.files;
			}
		}

		if (files) setFiles(Array.from(files));
	};

	const handleFileUploadChipClick = (file: File) => () => {
		setFiles((files) => files.filter((_file) => _file !== file));
	};

	const handleFileUploadImportButtonClick = async () => {
		setLoading(true);

		try {
			await Promise.all(
				Array.from(
					files,
					(file) =>
						new Promise((resolve) => {
							const reader = new FileReader();
							reader.readAsDataURL(file);
							reader.onloadend = async () => {
								try {
									await uploadImportFile({
										binaryContent: (reader.result as string).split(';base64,')[1],
										contentType: file.type,
										fileName: file.name,
										importerKey,
									});
								} catch (error) {
									handleError(error, t('Failed_To_upload_Import_File'));
								} finally {
									resolve();
								}
							};
							reader.onerror = () => resolve();
						}),
				),
			);
			router.navigate('/admin/import/prepare');
		} finally {
			setLoading(false);
		}
	};

	const [fileUrl, setFileUrl] = useSafely(useState(''));

	const handleFileUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
		setFileUrl(event.currentTarget.value);
	};

	const handleFileUrlImportButtonClick = async () => {
		setLoading(true);

		try {
			await downloadPublicImportFile({ importerKey, fileUrl });
			dispatchToastMessage({ type: 'success', message: t('Import_requested_successfully') });
			router.navigate('/admin/import/prepare');
		} catch (error) {
			handleError(error, t('Failed_To_upload_Import_File'));
		} finally {
			setLoading(false);
		}
	};

	const [filePath, setFilePath] = useSafely(useState(''));

	const handleFilePathChange = (event: ChangeEvent<HTMLInputElement>) => {
		setFilePath(event.currentTarget.value);
	};

	const handleFilePathImportButtonClick = async () => {
		setLoading(true);

		try {
			await downloadPublicImportFile({ importerKey, fileUrl: filePath });
			dispatchToastMessage({ type: 'success', message: t('Import_requested_successfully') });
			router.navigate('/admin/import/prepare');
		} catch (error) {
			handleError(error, t('Failed_To_upload_Import_File'));
		} finally {
			setLoading(false);
		}
	};

	const importerKeySelectId = useUniqueId();
	const fileTypeSelectId = useUniqueId();
	const fileSourceInputId = useUniqueId();
	const handleImportButtonClick =
		(fileType === 'upload' && handleFileUploadImportButtonClick) ||
		(fileType === 'url' && handleFileUrlImportButtonClick) ||
		(fileType === 'path' && handleFilePathImportButtonClick);

	return (
		<Page className='page-settings'>
			<Page.Header title={t('Import_New_File')}>
				<ButtonGroup>
					<Button icon='back' secondary onClick={handleBackToImportsButtonClick}>
						{t('Back_to_imports')}
					</Button>
					{importer && (
						<Button primary minHeight='x40' disabled={isLoading} onClick={handleImportButtonClick}>
							{isLoading ? <Throbber inheritColor /> : t('Import')}
						</Button>
					)}
				</ButtonGroup>
			</Page.Header>
			<Page.ScrollableContentWithShadow>
				<Box marginInline='auto' marginBlock='neg-x24' width='full' maxWidth='x580'>
					<Margins block='x24'>
						<Field>
							<Field.Label alignSelf='stretch' htmlFor={importerKeySelectId}>
								{t('Import_Type')}
							</Field.Label>
							<Field.Row>
								<Select
									id={importerKeySelectId}
									value={importerKey}
									disabled={isLoading}
									placeholder={t('Select_an_option')}
									onChange={handleImporterKeyChange}
									options={Importers.getAll().map(({ key, name }) => [key, t(name as TranslationKey)])}
								/>
							</Field.Row>
							{importer && (
								<Field.Hint>
									{importer.name === 'CSV'
										? t('Importer_From_Description_CSV')
										: t('Importer_From_Description', { from: t(importer.name as TranslationKey) })}
								</Field.Hint>
							)}
						</Field>
						{importer && (
							<Field>
								<Field.Label alignSelf='stretch' htmlFor={fileTypeSelectId}>
									{t('File_Type')}
								</Field.Label>
								<Field.Row>
									<Select
										id={fileTypeSelectId}
										value={fileType}
										disabled={isLoading}
										placeholder={t('Select_an_option')}
										onChange={handleFileTypeChange}
										options={[
											['upload', t('Upload')],
											['url', t('Public_URL')],
											['path', t('Server_File_Path')],
										]}
									/>
								</Field.Row>
							</Field>
						)}
						{importer && (
							<>
								{fileType === 'upload' && (
									<>
										{typeof maxFileSize === 'number' && maxFileSize > 0 ? (
											<Callout type='warning' marginBlock='x16'>
												{t('Importer_Upload_FileSize_Message', {
													maxFileSize: formatMemorySize(maxFileSize),
												})}
											</Callout>
										) : (
											<Callout type='info' marginBlock='x16'>
												{t('Importer_Upload_Unlimited_FileSize')}
											</Callout>
										)}
										<Field>
											<Field.Label alignSelf='stretch' htmlFor={fileSourceInputId}>
												{t('Importer_Source_File')}
											</Field.Label>
											<Field.Row>
												<InputBox type='file' id={fileSourceInputId} onChange={handleImportFileChange} />
											</Field.Row>
											{files?.length > 0 && (
												<Field.Row>
													{files.map((file, i) => (
														<Chip key={i} onClick={handleFileUploadChipClick(file)}>
															{file.name}
														</Chip>
													))}
												</Field.Row>
											)}
										</Field>
									</>
								)}
								{fileType === 'url' && (
									<Field>
										<Field.Label alignSelf='stretch' htmlFor={fileSourceInputId}>
											{t('File_URL')}
										</Field.Label>
										<Field.Row>
											<UrlInput id={fileSourceInputId} value={fileUrl} onChange={handleFileUrlChange} />
										</Field.Row>
									</Field>
								)}
								{fileType === 'path' && (
									<Field>
										<Field.Label alignSelf='stretch' htmlFor={fileSourceInputId}>
											{t('File_Path')}
										</Field.Label>
										<Field.Row>
											<TextInput id={fileSourceInputId} value={filePath} onChange={handleFilePathChange} />
										</Field.Row>
									</Field>
								)}
							</>
						)}
					</Margins>
				</Box>
			</Page.ScrollableContentWithShadow>
		</Page>
	);
}

export default NewImportPage;
