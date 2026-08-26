import { Module } from '@nestjs/common';

import { CommentsModule } from '../comments/comments.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { ClientController } from './client.controller';
import { ClientService } from './client.service';

@Module({
  imports: [CommentsModule, ReviewsModule],
  controllers: [ClientController],
  providers: [ClientService],
})
export class ClientModule {}
