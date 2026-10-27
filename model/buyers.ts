

export interface buyer {
    buyer_id: number;
    first_name: string;
    last_name: string;
    phone_number: string;
    latitude: string;
    longitude: string;
}

export interface buyerPostRequest {
    first_name: string;
    last_name: string;
    phone_number: string;
    latitude: string;
    longitude: string;
}

export interface NearbyQueryParams {
    lat?: string;
    lng?: string;
    radiusKm?: string;
}