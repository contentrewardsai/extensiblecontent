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

export interface FollowingInsert {
	name: string;
	birthday?: string | null;
	accounts?: FollowingAccountInsert[];
	emails?: FollowingEmailInsert[];
	phones?: FollowingPhoneInsert[];
	addresses?: FollowingAddressInsert[];
	notes?: FollowingNoteInsert[];
}

export interface FollowingUpdate {
	name?: string;
	birthday?: string | null;
	accounts?: FollowingAccountInsert[];
	emails?: FollowingEmailInsert[];
	phones?: FollowingPhoneInsert[];
	addresses?: FollowingAddressInsert[];
	notes?: FollowingNoteInsert[];
}
