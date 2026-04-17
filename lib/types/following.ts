export interface FollowingAccount {
	id: string;
	following_id: string;
	handle: string | null;
	url: string | null;
	platform_id: string;
	platform?: { id: string; name: string; slug: string };
	deleted: boolean;
	created_at: string;
	updated_at: string;
}

export interface FollowingEmail {
	id: string;
	following_id: string;
	email: string;
	added_by: string;
	deleted: boolean;
	created_at: string;
	updated_at: string;
}

export interface FollowingPhone {
	id: string;
	following_id: string;
	phone_number: string;
	added_by: string;
	deleted: boolean;
	created_at: string;
	updated_at: string;
}

export interface FollowingAddress {
	id: string;
	following_id: string;
	address: string | null;
	address_2: string | null;
	city: string | null;
	state: string | null;
	zip: string | null;
	country: string | null;
	added_by: string;
	deleted: boolean;
	created_at: string;
	updated_at: string;
}

export interface FollowingNote {
	id: string;
	following_id: string;
	note: string;
	added_by: string;
	access: string | null;
	scheduled: string | null;
	deleted: boolean;
	created_at: string;
	updated_at: string;
}

export type FollowingWalletChain = "solana" | "evm";

export interface FollowingWallet {
	id: string;
	following_id: string;
	chain: FollowingWalletChain;
	address: string;
	network: string | null;
	label: string | null;
	watch_enabled: boolean;
	automation_enabled: boolean;
	auto_execute_swaps: boolean;
	size_mode: string | null;
	quote_mint: string | null;
	fixed_amount_raw: string | null;
	usd_amount: string | null;
	proportional_scale_percent: number | null;
	slippage_bps: number | null;
	added_by: string;
	deleted: boolean;
	created_at: string;
	updated_at: string;
}

export interface Following {
	id: string;
	user_id: string;
	name: string;
	birthday: string | null;
	deleted: boolean;
	created_at: string;
	updated_at: string;
	accounts: FollowingAccount[];
	emails: FollowingEmail[];
	phones: FollowingPhone[];
	addresses: FollowingAddress[];
	notes: FollowingNote[];
	wallets: FollowingWallet[];
}

export interface FollowingAccountInsert {
	handle?: string | null;
	url?: string | null;
	platform_id: string;
}

export interface FollowingEmailInsert {
	email: string;
}

export interface FollowingPhoneInsert {
	phone_number: string;
}

export interface FollowingAddressInsert {
	address?: string | null;
	address_2?: string | null;
	city?: string | null;
	state?: string | null;
	zip?: string | null;
	country?: string | null;
}

export interface FollowingNoteInsert {
	note: string;
	access?: string | null;
	scheduled?: string | null;
}

export interface FollowingWalletInsert {
	chain: FollowingWalletChain;
	address: string;
	network?: string | null;
	label?: string | null;
	watch_enabled?: boolean;
	automation_enabled?: boolean;
	auto_execute_swaps?: boolean;
	size_mode?: string | null;
	quote_mint?: string | null;
	fixed_amount_raw?: string | null;
	usd_amount?: string | null;
	proportional_scale_percent?: number | null;
	slippage_bps?: number | null;
	// camelCase aliases accepted on input (extension uses these in JSON files)
	watchEnabled?: boolean;
	automationEnabled?: boolean;
	autoExecuteSwaps?: boolean;
	sizeMode?: string | null;
	quoteMint?: string | null;
	fixedAmountRaw?: string | null;
	usdAmount?: string | null;
	proportionalScalePercent?: number | null;
	slippageBps?: number | null;
}

export interface FollowingInsert {
	name: string;
	birthday?: string | null;
	accounts?: FollowingAccountInsert[];
	emails?: FollowingEmailInsert[];
	phones?: FollowingPhoneInsert[];
	addresses?: FollowingAddressInsert[];
	notes?: FollowingNoteInsert[];
	wallets?: FollowingWalletInsert[];
}

export interface FollowingUpdate {
	name?: string;
	birthday?: string | null;
	accounts?: FollowingAccountInsert[];
	emails?: FollowingEmailInsert[];
	phones?: FollowingPhoneInsert[];
	addresses?: FollowingAddressInsert[];
	notes?: FollowingNoteInsert[];
	wallets?: FollowingWalletInsert[];
}
